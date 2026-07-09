import os
import sys
import io
import pytest
import pytest_asyncio
from uuid import uuid4, UUID
from unittest.mock import AsyncMock, MagicMock, patch

from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import select

# Add nexus-backend to python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import app
from database import get_db, Base
from models import User, Conversation, Participant, Message, MessageReceipt
from services.websocket_manager import manager

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
async def test_audio_upload_validations(client):
    # Setup mock user and conversation
    user_id = uuid4()
    conv_id = uuid4()

    async with TestingSessionLocal() as db:
        user = User(id=user_id, phone="+919999999999", display_name="Test User", is_active=True)
        conv = Conversation(id=conv_id, is_group=False)
        participant = Participant(user_id=user_id, conversation_id=conv_id, role="member")
        db.add_all([user, conv, participant])
        await db.commit()

    # Mock decode_access_token to bypass JWT middleware
    with patch("routers.auth.decode_access_token") as mock_decode, \
         patch("services.websocket_manager.manager.broadcast_to_conversation", new_callable=AsyncMock) as mock_broadcast:
        
        mock_decode.return_value = {"sub": str(user_id)}
        headers = {"Authorization": "Bearer mock_token"}

        # 1. Test invalid file extension
        invalid_file = io.BytesIO(b"dummy content")
        res = client.post(
            "/upload/media",
            headers=headers,
            files={"file": ("test.exe", invalid_file, "application/octet-stream")},
            data={"conversation_id": str(conv_id), "duration": 12.5}
        )
        assert res.status_code == 400
        assert "is not supported" in res.json()["detail"]

        # 2. Test invalid MIME type for valid extension
        invalid_mime_file = io.BytesIO(b"dummy audio")
        res = client.post(
            "/upload/media",
            headers=headers,
            files={"file": ("test.mp3", invalid_mime_file, "image/png")},
            data={"conversation_id": str(conv_id), "duration": 12.5}
        )
        assert res.status_code == 400
        assert "MIME type" in res.json()["detail"]

        # 3. Test size exceeds 20MB limit
        large_file = io.BytesIO(b"0" * (20 * 1024 * 1024 + 1))
        res = client.post(
            "/upload/media",
            headers=headers,
            files={"file": ("test.mp3", large_file, "audio/mpeg")},
            data={"conversation_id": str(conv_id), "duration": 12.5}
        )
        assert res.status_code == 400
        assert "size exceeds" in res.json()["detail"]

        # 4. Test missing conversation_id for audio uploads
        valid_audio = io.BytesIO(b"dummy audio data")
        res = client.post(
            "/upload/media",
            headers=headers,
            files={"file": ("test.mp3", valid_audio, "audio/mpeg")},
            data={"duration": 12.5}
        )
        assert res.status_code == 400
        assert "conversation_id is required" in res.json()["detail"]

        # 5. Test valid audio note upload and database creation
        valid_audio_ok = io.BytesIO(b"dummy audio data")
        res = client.post(
            "/upload/media",
            headers=headers,
            files={"file": ("test.webm", valid_audio_ok, "audio/webm")},
            data={"conversation_id": str(conv_id), "duration": 15.4}
        )
        assert res.status_code == 201
        data = res.json()
        assert "id" in data
        assert data["media_url"].startswith("/media/")
        assert data["duration"] == 15
        assert data["message_type"] == "audio"

        # Verify DB entry
        async with TestingSessionLocal() as db:
            result = await db.execute(select(Message).where(Message.id == UUID(data["id"])))
            msg = result.scalar_one_or_none()
            assert msg is not None
            assert msg.message_type == "audio"
            assert msg.duration == 15
            assert msg.file_size == len(b"dummy audio data")
            assert msg.mime_type == "audio/webm"

        # Verify WebSocket broadcast was called (since it's an audio note, it should broadcast to others)
        mock_broadcast.assert_called()
