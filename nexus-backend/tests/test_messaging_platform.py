import os
import sys
import time
import pytest
import pytest_asyncio
from uuid import uuid4, UUID
from fastapi import HTTPException
from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import select

# Add parent directory to path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import app
from database import get_db, Base
from models import User, Device, Conversation, Participant, Message, MessageReceipt
from routers.auth import create_access_token
from messaging import (
    attachment_service,
    typing_manager,
    message_service,
    read_receipts_service,
    delivery_engine
)

TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"
engine = create_async_engine(TEST_DATABASE_URL, echo=False)
TestingSessionLocal = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

async def override_get_db():
    async with TestingSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise

@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)
    await engine.dispose()

@pytest.fixture
def client():
    app.dependency_overrides[get_db] = override_get_db
    import routers.chat
    original_session = routers.chat.async_session
    routers.chat.async_session = TestingSessionLocal
    yield TestClient(app)
    routers.chat.async_session = original_session
    app.dependency_overrides.pop(get_db, None)


# ── 1. Attachment Service Tests ──────────────────────────────────────────────

class MockFile:
    def __init__(self, filename, content_type):
        self.filename = filename
        self.content_type = content_type

def test_attachment_size_and_type_validation():
    # Valid Image
    img_file = MockFile("avatar.png", "image/png")
    assert attachment_service.validate_file(img_file, 5 * 1024 * 1024) == "image"

    # Exceeding Image size (12MB > 10MB limit)
    with pytest.raises(HTTPException) as exc:
        attachment_service.validate_file(img_file, 12 * 1024 * 1024)
    assert exc.value.status_code == 400
    assert "exceeds" in exc.value.detail

    # Valid PDF (45MB < 50MB limit)
    pdf_file = MockFile("doc.pdf", "application/pdf")
    assert attachment_service.validate_file(pdf_file, 45 * 1024 * 1024) == "pdf"

    # Exceeding PDF size (52MB > 50MB limit)
    with pytest.raises(HTTPException) as exc:
        attachment_service.validate_file(pdf_file, 52 * 1024 * 1024)
    assert exc.value.status_code == 400

    # Inconsistent mime
    inconsistent = MockFile("photo.png", "audio/mp3")
    with pytest.raises(HTTPException) as exc:
        attachment_service.validate_file(inconsistent, 1 * 1024 * 1024)
    assert exc.value.status_code == 400
    assert "Inconsistent" in exc.value.detail


# ── 2. Typing Manager Tests ──────────────────────────────────────────────────

def test_typing_manager_lifecycle():
    conv_id = str(uuid4())
    user_1 = str(uuid4())
    user_2 = str(uuid4())

    typing_manager.set_typing(user_1, conv_id)
    typing_manager.set_typing(user_2, conv_id)

    users = typing_manager.get_typing_users(conv_id)
    assert user_1 in users
    assert user_2 in users

    typing_manager.clear_typing(user_1, conv_id)
    assert user_1 not in typing_manager.get_typing_users(conv_id)

    # Test Timeout expiration
    typing_manager.timeout = 0.05
    typing_manager.set_typing(user_2, conv_id)
    time.sleep(0.06)
    assert user_2 not in typing_manager.get_typing_users(conv_id)
    typing_manager.timeout = 4.0  # reset


# ── 3. Message Service Rate Limiting Tests ───────────────────────────────────

def test_message_service_rate_limiter():
    uid = uuid4()
    # Refill 1 token per 10 seconds, capacity 2
    message_service._rate_limiter.capacity = 2
    message_service._rate_limiter.refill_rate = 0.1

    # First request
    message_service.check_rate_limit(uid)
    # Second request
    message_service.check_rate_limit(uid)
    # Third request - raises 429
    with pytest.raises(HTTPException) as exc:
        message_service.check_rate_limit(uid)
    assert exc.value.status_code == 429


# ── 4. End-to-End WebSocket Messaging Tests ──────────────────────────────────

def receive_event(ws, event_name: str, timeout: float = 2.0):
    start_time = time.time()
    while time.time() - start_time < timeout:
        res = ws.receive_json()
        if res.get("event") == event_name:
            return res
    raise TimeoutError(f"Event '{event_name}' not received within {timeout} seconds")

@pytest.mark.asyncio
async def test_websocket_e2e_delivery_and_receipts(client):
    alice_id = uuid4()
    bob_id = uuid4()
    conv_id = uuid4()

    async with TestingSessionLocal() as db:
        alice = User(id=alice_id, phone="+919999999901", display_name="Alice")
        bob = User(id=bob_id, phone="+919999999902", display_name="Bob")
        db.add_all([alice, bob])
        await db.commit()

        conv = Conversation(id=conv_id, is_group=False)
        db.add(conv)
        await db.commit()

        p1 = Participant(user_id=alice_id, conversation_id=conv_id)
        p2 = Participant(user_id=bob_id, conversation_id=conv_id)
        db.add_all([p1, p2])
        await db.commit()

    # Access tokens
    alice_token = create_access_token(str(alice_id))
    bob_token = create_access_token(str(bob_id))

    # Connect Bob first to receive Alice's messages
    with client.websocket_connect(f"/ws/{bob_id}?token={bob_token}") as bob_ws:
        # Connect Alice
        with client.websocket_connect(f"/ws/{alice_id}?token={alice_token}") as alice_ws:
            # Alice sends a message
            msg_payload = {
                "event": "new_message",
                "conversation_id": str(conv_id),
                "content": "Hello Bob!",
                "message_type": "text"
            }
            alice_ws.send_json(msg_payload)

            # Alice receives "message_sent" confirmation
            alice_resp = receive_event(alice_ws, "message_sent")
            msg_id = alice_resp["message"]["id"]

            # Bob receives Alice's message in real time
            bob_resp = receive_event(bob_ws, "new_message")
            assert bob_resp["message"]["content"] == "Hello Bob!"

            # Bob marks it as read
            bob_ws.send_json({
                "event": "mark_read",
                "conversation_id": str(conv_id),
                "message_id": msg_id
            })

            # Alice receives Bob's read_receipt
            alice_read_receipt = receive_event(alice_ws, "read_receipt")
            assert alice_read_receipt["message_id"] == msg_id

            # Alice receives Bob's message_read confirmation
            alice_msg_read = receive_event(alice_ws, "message_read")
            assert alice_msg_read["message_id"] == msg_id
