import os
import sys
import json
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
from models import User, Conversation, Participant, Message, PushToken
from services.websocket_manager import manager
from routers.chat import enqueue_notification

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
async def test_push_token_lifecycle(client):
    # Setup mock users
    user1_id = uuid4()
    user2_id = uuid4()

    async with TestingSessionLocal() as db:
        user1 = User(id=user1_id, phone="+919999999901", display_name="Aarav", is_active=True)
        user2 = User(id=user2_id, phone="+919999999902", display_name="Rahul", is_active=True)
        db.add_all([user1, user2])
        await db.commit()

    # Mock JWT authentication middleware
    with patch("routers.auth.decode_access_token") as mock_decode:
        # Register token for User 1
        mock_decode.return_value = {"sub": str(user1_id)}
        headers = {"Authorization": "Bearer mock_token"}
        
        # 1. POST /push-token (Register)
        res = client.post(
            "/push-token",
            headers=headers,
            json={"push_token": "token_web_123", "platform": "web"}
        )
        assert res.status_code == 200
        data = res.json()
        assert data["token"] == "token_web_123"
        assert data["platform"] == "web"
        assert data["user_id"] == str(user1_id)

        # 2. GET /push-token (List active tokens)
        res = client.get("/push-token", headers=headers)
        assert res.status_code == 200
        tokens_list = res.json()
        assert len(tokens_list) == 1
        assert tokens_list[0]["token"] == "token_web_123"

        # 3. Token Takeover (User 2 registers the SAME token)
        mock_decode.return_value = {"sub": str(user2_id)}
        res = client.post(
            "/push-token",
            headers=headers,
            json={"push_token": "token_web_123", "platform": "web"}
        )
        assert res.status_code == 200
        data = res.json()
        assert data["user_id"] == str(user2_id) # Ownership transferred!

        # Check in DB that only 1 record exists for this token
        async with TestingSessionLocal() as db:
            result = await db.execute(select(PushToken).where(PushToken.token == "token_web_123"))
            records = result.scalars().all()
            assert len(records) == 1
            assert records[0].user_id == user2_id

        # 4. DELETE /push-token (Remove token)
        res = client.delete(
            f"/push-token?token=token_web_123",
            headers=headers
        )
        assert res.status_code == 200
        assert res.json() == {"message": "Push token removed successfully"}

        # Double check it is deleted
        async with TestingSessionLocal() as db:
            result = await db.execute(select(PushToken).where(PushToken.token == "token_web_123"))
            assert result.scalar_one_or_none() is None

@pytest.mark.asyncio
async def test_websocket_active_chat_tracking():
    user_id = str(uuid4())
    conv_id = str(uuid4())

    assert not manager.is_user_viewing_chat(user_id, conv_id)
    
    manager.enter_conversation(user_id, conv_id)
    assert manager.is_user_viewing_chat(user_id, conv_id)
    assert not manager.is_user_viewing_chat(user_id, str(uuid4()))

    manager.leave_conversation(user_id)
    assert not manager.is_user_viewing_chat(user_id, conv_id)

@pytest.mark.asyncio
async def test_notification_trigger_logic():
    user1_id = uuid4()
    user2_id = uuid4()
    conv_id = uuid4()
    msg_id = uuid4()

    async with TestingSessionLocal() as db:
        user1 = User(id=user1_id, phone="+919999999901", display_name="Aarav", is_active=True)
        user2 = User(id=user2_id, phone="+919999999902", display_name="Rahul", is_active=True)
        conv = Conversation(id=conv_id, is_group=False)
        p1 = Participant(user_id=user1_id, conversation_id=conv_id, role="member")
        p2 = Participant(user_id=user2_id, conversation_id=conv_id, role="member")
        db.add_all([user1, user2, conv, p1, p2])
        await db.commit()

    # Case 1: User 2 is offline -> notification enqueued
    mock_redis = AsyncMock()
    mock_redis.rpush = AsyncMock()
    
    with patch.object(manager, "_redis", mock_redis), \
         patch.object(manager, "is_online", new_callable=AsyncMock) as mock_is_online:
        
        mock_is_online.return_value = False # User 2 is offline
        
        async with TestingSessionLocal() as db:
            await enqueue_notification(
                db,
                sender_id=user1_id,
                conversation_id=conv_id,
                message_id=msg_id,
                message_type="text",
                content="Hey Rahul!"
            )
            
            # Assert redis push was called once
            assert mock_redis.rpush.call_count == 1
            call_args = mock_redis.rpush.call_args[0]
            assert call_args[0] == "nexus:notifications"
            job = json.loads(call_args[1])
            assert job["user_id"] == str(user2_id)
            assert job["title"] == "Aarav"
            assert job["body"] == "Hey Rahul!"
            assert job["conversation_id"] == str(conv_id)
            assert job["message_id"] == str(msg_id)
            assert job["type"] == "message"

    # Case 2: User 2 is online and actively viewing -> no notification enqueued
    mock_redis.rpush.reset_mock()
    with patch.object(manager, "_redis", mock_redis), \
         patch.object(manager, "is_online", new_callable=AsyncMock) as mock_is_online:
        
        mock_is_online.return_value = True # User 2 is online
        manager.enter_conversation(str(user2_id), str(conv_id)) # User 2 is viewing same chat
        
        async with TestingSessionLocal() as db:
            await enqueue_notification(
                db,
                sender_id=user1_id,
                conversation_id=conv_id,
                message_id=msg_id,
                message_type="text",
                content="Hey Rahul!"
            )
            
            # Assert redis push was not called
            assert mock_redis.rpush.call_count == 0

    # Cleanup active chat tracker state
    manager.leave_conversation(str(user2_id))
