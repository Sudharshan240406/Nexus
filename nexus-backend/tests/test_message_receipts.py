import os
import sys
import pytest
import pytest_asyncio
from datetime import datetime, timezone, timedelta
from uuid import uuid4, UUID
from unittest.mock import AsyncMock, MagicMock, patch

from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession
from sqlalchemy import select, update
from sqlalchemy.orm import selectinload

# Add nexus-backend to python path
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from database import Base
from models import User, Conversation, Participant, Message, MessageReceipt
from routers.chat import _build_message_out

# Use SQLite in-memory for testing
TEST_DATABASE_URL = "sqlite+aiosqlite:///:memory:"

@pytest_asyncio.fixture
async def async_db_session():
    engine = create_async_engine(TEST_DATABASE_URL, echo=False)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    
    session_factory = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)
    async with session_factory() as session:
        yield session
    
    await engine.dispose()

@pytest.mark.asyncio
async def test_message_status_calculation():
    # 1. Test when no other receipts exist (e.g. self chat)
    sender_id = uuid4()
    msg = Message(
        id=uuid4(),
        conversation_id=uuid4(),
        sender_id=sender_id,
        content="Test",
        message_type="text",
        is_deleted=False,
        is_edited=False,
        created_at=datetime.now(timezone.utc),
        receipts=[]
    )
    msg_out = await _build_message_out(msg)
    assert msg_out.status == "sent"

    # 2. Test when receipts are "sent"
    r1 = MessageReceipt(user_id=uuid4(), status="sent")
    r2 = MessageReceipt(user_id=uuid4(), status="sent")
    msg.receipts = [r1, r2]
    msg_out = await _build_message_out(msg)
    assert msg_out.status == "sent"

    # 3. Test when one is "delivered", one is "sent"
    r1.status = "delivered"
    msg_out = await _build_message_out(msg)
    assert msg_out.status == "sent"

    # 4. Test when both are "delivered"
    r2.status = "delivered"
    msg_out = await _build_message_out(msg)
    assert msg_out.status == "delivered"

    # 5. Test when one is "read", one is "delivered"
    r1.status = "read"
    msg_out = await _build_message_out(msg)
    assert msg_out.status == "delivered"

    # 6. Test when both are "read"
    r2.status = "read"
    msg_out = await _build_message_out(msg)
    assert msg_out.status == "read"


@pytest.mark.asyncio
async def test_database_persistence(async_db_session):
    # Create test data
    user_a = User(id=uuid4(), phone="+919999999901", display_name="User A", is_active=True)
    user_b = User(id=uuid4(), phone="+919999999902", display_name="User B", is_active=True)
    async_db_session.add_all([user_a, user_b])
    await async_db_session.commit()

    conv = Conversation(id=uuid4(), is_group=False)
    async_db_session.add(conv)
    await async_db_session.commit()

    msg = Message(
        id=uuid4(),
        conversation_id=conv.id,
        sender_id=user_a.id,
        content="Hello!",
        message_type="text",
        is_deleted=False,
        is_edited=False
    )
    async_db_session.add(msg)
    await async_db_session.commit()

    # Create receipts
    receipt = MessageReceipt(
        id=uuid4(),
        message_id=msg.id,
        user_id=user_b.id,
        status="sent"
    )
    async_db_session.add(receipt)
    await async_db_session.commit()

    # Verify query and relationship
    result = await async_db_session.execute(
        select(Message)
        .options(selectinload(Message.receipts))
        .where(Message.id == msg.id)
    )
    db_msg = result.scalar_one()
    assert len(db_msg.receipts) == 1
    assert db_msg.receipts[0].status == "sent"
    assert db_msg.receipts[0].user_id == user_b.id


@pytest.mark.asyncio
async def test_chat_rest_mark_read_logic(async_db_session):
    # Setup users, conversation, messages and receipts
    user_a = User(id=uuid4(), phone="+919999999911", display_name="User A", is_active=True)
    user_b = User(id=uuid4(), phone="+919999999912", display_name="User B", is_active=True)
    async_db_session.add_all([user_a, user_b])
    await async_db_session.commit()

    conv = Conversation(id=uuid4(), is_group=False)
    async_db_session.add(conv)
    await async_db_session.commit()

    msg = Message(
        id=uuid4(),
        conversation_id=conv.id,
        sender_id=user_a.id,
        content="Hello B!",
        message_type="text",
        is_deleted=False,
        is_edited=False
    )
    async_db_session.add(msg)
    await async_db_session.commit()

    receipt = MessageReceipt(
        id=uuid4(),
        message_id=msg.id,
        user_id=user_b.id,
        status="delivered"
    )
    async_db_session.add(receipt)
    await async_db_session.commit()

    # Simulate User B opening the chat (GET messages logic)
    unread_receipts_result = await async_db_session.execute(
        select(MessageReceipt)
        .join(Message, Message.id == MessageReceipt.message_id)
        .where(
            Message.conversation_id == conv.id,
            MessageReceipt.user_id == user_b.id,
            MessageReceipt.status != "read"
        )
    )
    unread_receipts = unread_receipts_result.scalars().all()
    assert len(unread_receipts) == 1

    # Update to read
    for r in unread_receipts:
        r.status = "read"
    await async_db_session.commit()

    # Verify update
    updated_receipt_res = await async_db_session.execute(
        select(MessageReceipt).where(MessageReceipt.id == receipt.id)
    )
    updated_receipt = updated_receipt_res.scalar_one()
    assert updated_receipt.status == "read"


@pytest.mark.asyncio
async def test_websocket_mark_read_receipt_logic(async_db_session):
    # Setup test data
    user_a = User(id=uuid4(), phone="+919999999921", display_name="User A", is_active=True)
    user_b = User(id=uuid4(), phone="+919999999922", display_name="User B", is_active=True)
    async_db_session.add_all([user_a, user_b])
    await async_db_session.commit()

    conv = Conversation(id=uuid4(), is_group=False)
    async_db_session.add(conv)
    await async_db_session.commit()

    # Two messages sent by User A
    msg1 = Message(id=uuid4(), conversation_id=conv.id, sender_id=user_a.id, content="Hi", message_type="text", is_deleted=False, is_edited=False, created_at=datetime.now(timezone.utc) - timedelta(minutes=2))
    msg2 = Message(id=uuid4(), conversation_id=conv.id, sender_id=user_a.id, content="How are you?", message_type="text", is_deleted=False, is_edited=False, created_at=datetime.now(timezone.utc))
    async_db_session.add_all([msg1, msg2])
    await async_db_session.commit()

    r1 = MessageReceipt(id=uuid4(), message_id=msg1.id, user_id=user_b.id, status="delivered")
    r2 = MessageReceipt(id=uuid4(), message_id=msg2.id, user_id=user_b.id, status="delivered")
    async_db_session.add_all([r1, r2])
    await async_db_session.commit()

    # User B marks up to msg2 as read
    target_msg = msg2
    receipts_res = await async_db_session.execute(
        select(MessageReceipt)
        .join(Message, Message.id == MessageReceipt.message_id)
        .where(
            Message.conversation_id == conv.id,
            MessageReceipt.user_id == user_b.id,
            MessageReceipt.status != "read",
            Message.created_at <= target_msg.created_at
        )
    )
    receipts_to_read = receipts_res.scalars().all()
    assert len(receipts_to_read) == 2

    for r in receipts_to_read:
        r.status = "read"
    await async_db_session.commit()

    # Verify both are updated
    r1_updated = (await async_db_session.execute(select(MessageReceipt).where(MessageReceipt.id == r1.id))).scalar_one()
    r2_updated = (await async_db_session.execute(select(MessageReceipt).where(MessageReceipt.id == r2.id))).scalar_one()
    assert r1_updated.status == "read"
    assert r2_updated.status == "read"


@pytest.mark.asyncio
async def test_connection_manager_delivery_and_broadcast():
    from services.websocket_manager import ConnectionManager
    manager = ConnectionManager()
    
    # Mock redis and socket
    manager._redis = MagicMock()
    manager._redis.set = AsyncMock()
    manager._redis.delete = AsyncMock()
    manager._redis.rpush = AsyncMock()
    manager._redis.lpop = AsyncMock(return_value=None)
    
    ws1 = MagicMock()
    ws1.accept = AsyncMock()
    ws1.send_json = AsyncMock()
    
    ws2 = MagicMock()
    ws2.accept = AsyncMock()
    ws2.send_json = AsyncMock(side_effect=Exception("Failed send")) # Stale connection
    
    # Test connect
    await manager.connect("user_1", ws1)
    assert manager._connections["user_1"] == ws1
    
    await manager.connect("user_2", ws2)
    assert manager._connections["user_2"] == ws2
    
    # Test broadcast
    payload = {"event": "new_message", "message": {"id": "msg_123"}}
    delivered = await manager.broadcast_to_conversation(["user_1", "user_2", "user_3"], payload, exclude="user_3")
    
    # ws1 should succeed (delivers to user_1)
    # ws2 should fail (removes user_2)
    # user_3 is excluded
    assert "user_1" in delivered
    assert "user_2" not in delivered
    
    # ws1 should have received the payload
    ws1.send_json.assert_called_with(payload)
