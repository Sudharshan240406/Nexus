import os
import sys
import io
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
from routers.auth import create_access_token

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
async def test_encrypted_upload_unauthorized(client):
    # Test uploading without auth token
    invalid_file = io.BytesIO(b"encrypted_data")
    res = client.post(
        "/upload/media",
        files={"file": ("test.png", invalid_file, "image/png")},
        data={"conversation_id": str(uuid4()), "encryption_version": "1"}
    )
    assert res.status_code == 401

@pytest.mark.asyncio
async def test_encrypted_upload_and_download_success(client):
    user_id = uuid4()
    conv_id = uuid4()

    async with TestingSessionLocal() as db:
        user = User(id=user_id, phone="+919999999901", display_name="Alice", is_active=True)
        conv = Conversation(id=conv_id, is_group=False)
        participant = Participant(user_id=user_id, conversation_id=conv_id, role="member")
        db.add_all([user, conv, participant])
        await db.commit()

    token = create_access_token(str(user_id))
    headers = {"Authorization": f"Bearer {token}"}

    # Simulate client-side encrypted payload
    encrypted_file_content = b"client_encrypted_ciphertext_bytes"
    mock_file = io.BytesIO(encrypted_file_content)

    with patch("routers.auth.decode_access_token") as mock_decode, \
         patch("services.websocket_manager.manager.broadcast_to_conversation", new_callable=AsyncMock) as mock_broadcast:
        
        mock_decode.return_value = {"sub": str(user_id)}

        # 1. Perform E2EE audio message upload
        res = client.post(
            "/upload/media",
            headers=headers,
            files={"file": ("voice_note.webm", mock_file, "audio/webm")},
            data={
                "conversation_id": str(conv_id),
                "duration": "5.8",
                "encryption_version": "1",
                "nonce": "iv_base64_string",
                "message_counter": "12345",
                "algorithm": "AES-GCM-256",
                "sender_device_id": "alice_device_uuid",
                "content": '{"encrypted_metadata":"meta_cipher","keys":{"bob_device":"key_cipher"}}'
            }
        )
        assert res.status_code == 201
        data = res.json()
        assert "id" in data
        media_url = data["media_url"]
        assert media_url.startswith("/media/")
        assert data["message_type"] == "enc_audio"

        # Verify DB entry
        async with TestingSessionLocal() as db:
            result = await db.execute(select(Message).where(Message.id == UUID(data["id"])))
            msg = result.scalar_one_or_none()
            assert msg is not None
            assert msg.message_type == "enc_audio"
            assert msg.media_url == media_url
            assert msg.encryption_version == "1"
            assert msg.nonce == "iv_base64_string"
            assert msg.message_counter == 12345
            assert msg.algorithm == "AES-GCM-256"
            assert msg.sender_device_id == "alice_device_uuid"
            # Metadata envelope is stored in the content column
            assert "encrypted_metadata" in msg.content

        # 2. Download the E2EE media file and verify content is exact ciphertext bytes
        dl_res = client.get(media_url)
        assert dl_res.status_code == 200
        assert dl_res.content == encrypted_file_content

@pytest.mark.asyncio
async def test_encrypted_upload_size_validation(client):
    user_id = uuid4()
    conv_id = uuid4()

    async with TestingSessionLocal() as db:
        user = User(id=user_id, phone="+919999999901", display_name="Alice", is_active=True)
        conv = Conversation(id=conv_id, is_group=False)
        participant = Participant(user_id=user_id, conversation_id=conv_id, role="member")
        db.add_all([user, conv, participant])
        await db.commit()

    token = create_access_token(str(user_id))
    headers = {"Authorization": f"Bearer {token}"}

    # Generate ciphertext larger than 10MB limit for audio/images
    large_audio_content = b"0" * (10 * 1024 * 1024 + 1)
    mock_file = io.BytesIO(large_audio_content)

    with patch("routers.auth.decode_access_token") as mock_decode:
        mock_decode.return_value = {"sub": str(user_id)}

        res = client.post(
            "/upload/media",
            headers=headers,
            files={"file": ("voice_note.webm", mock_file, "audio/webm")},
            data={
                "conversation_id": str(conv_id),
                "duration": "5.8",
                "encryption_version": "1",
                "nonce": "nonce_val",
                "message_counter": "1",
                "algorithm": "AES-GCM-256",
                "sender_device_id": "alice_device"
            }
        )
        assert res.status_code == 400
        assert "size exceeds" in res.json()["detail"]
