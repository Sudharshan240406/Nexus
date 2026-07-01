import os
import sys
import json
import pytest
import pytest_asyncio
from uuid import uuid4, UUID
from unittest.mock import AsyncMock, patch

from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import select

# Add nexus-backend to python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import app
from database import get_db, Base
from models import User, Conversation, Participant, Message, MessageReceipt
from routers.chat import _build_message_out

# Use SQLite in-memory for testing
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
    yield TestClient(app)
    app.dependency_overrides.pop(get_db, None)

@pytest.mark.asyncio
async def test_send_and_reply_via_rest(client):
    # Setup users and conversation
    user1_id = uuid4()
    conv_id = uuid4()

    async with TestingSessionLocal() as db:
        u1 = User(id=user1_id, phone="+919999999901", display_name="Aarav", is_active=True)
        conv = Conversation(id=conv_id, is_group=False)
        p1 = Participant(user_id=user1_id, conversation_id=conv_id, role="member")
        db.add_all([u1, conv, p1])
        await db.commit()

    # Generate token
    from routers.auth import create_access_token
    token = create_access_token(str(user1_id))
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Send REST message
    res = client.post(
        f"/conversations/{conv_id}/messages",
        headers=headers,
        json={"content": "Hello REST!", "message_type": "text"}
    )
    assert res.status_code == 201
    msg1 = res.json()
    assert msg1["content"] == "Hello REST!"
    assert msg1["is_pinned"] is False
    assert msg1["is_forwarded"] is False

    # 2. Reply to REST message
    res2 = client.post(
        f"/conversations/{conv_id}/messages",
        headers=headers,
        json={
            "content": "This is a reply!",
            "message_type": "text",
            "reply_to_message_id": msg1["id"]
        }
    )
    assert res2.status_code == 201
    msg2 = res2.json()
    assert msg2["content"] == "This is a reply!"
    assert msg2["reply_to_message_id"] == msg1["id"]
    assert msg2["reply_to_preview"] is not None
    assert msg2["reply_to_preview"]["id"] == msg1["id"]
    assert msg2["reply_to_preview"]["content"] == "Hello REST!"

@pytest.mark.asyncio
async def test_pin_and_unpin_lifecycle(client):
    user1_id = uuid4()
    conv_id = uuid4()
    msg_id = uuid4()

    async with TestingSessionLocal() as db:
        u1 = User(id=user1_id, phone="+919999999901", display_name="Aarav", is_active=True)
        conv = Conversation(id=conv_id, is_group=False)
        p1 = Participant(user_id=user1_id, conversation_id=conv_id, role="member")
        msg = Message(id=msg_id, conversation_id=conv_id, sender_id=user1_id, content="Original", message_type="text")
        db.add_all([u1, conv, p1, msg])
        await db.commit()

    from routers.auth import create_access_token
    token = create_access_token(str(user1_id))
    headers = {"Authorization": f"Bearer {token}"}

    # 1. Pin message
    res = client.post(f"/messages/{msg_id}/pin", headers=headers)
    assert res.status_code == 200
    assert res.json()["is_pinned"] is True

    # 2. Get pins list
    res_pins = client.get(f"/conversations/{conv_id}/pins", headers=headers)
    assert res_pins.status_code == 200
    pins_list = res_pins.json()
    assert len(pins_list) == 1
    assert pins_list[0]["id"] == str(msg_id)
    assert pins_list[0]["is_pinned"] is True

    # 3. Unpin message
    res_unpin = client.post(f"/messages/{msg_id}/unpin", headers=headers)
    assert res_unpin.status_code == 200
    assert res_unpin.json()["is_pinned"] is False

    # 4. Get pins list again
    res_pins2 = client.get(f"/conversations/{conv_id}/pins", headers=headers)
    assert res_pins2.status_code == 200
    assert len(res_pins2.json()) == 0

@pytest.mark.asyncio
async def test_forward_message(client):
    user1_id = uuid4()
    conv1_id = uuid4()
    conv2_id = uuid4()
    msg_id = uuid4()

    async with TestingSessionLocal() as db:
        u1 = User(id=user1_id, phone="+919999999901", display_name="Aarav", is_active=True)
        c1 = Conversation(id=conv1_id, is_group=False)
        c2 = Conversation(id=conv2_id, is_group=False)
        p1 = Participant(user_id=user1_id, conversation_id=conv1_id, role="member")
        p2 = Participant(user_id=user1_id, conversation_id=conv2_id, role="member")
        msg = Message(id=msg_id, conversation_id=conv1_id, sender_id=user1_id, content="Forward payload", message_type="text")
        db.add_all([u1, c1, c2, p1, p2, msg])
        await db.commit()

    from routers.auth import create_access_token
    token = create_access_token(str(user1_id))
    headers = {"Authorization": f"Bearer {token}"}

    # Forward to conv2
    res = client.post(
        f"/messages/{msg_id}/forward",
        headers=headers,
        json={"conversation_ids": [str(conv2_id)]}
    )
    assert res.status_code == 200
    forwarded = res.json()
    assert len(forwarded) == 1
    assert forwarded[0]["conversation_id"] == str(conv2_id)
    assert forwarded[0]["content"] == "Forward payload"
    assert forwarded[0]["is_forwarded"] is True
    assert forwarded[0]["forwarded_from"] == "Aarav"
