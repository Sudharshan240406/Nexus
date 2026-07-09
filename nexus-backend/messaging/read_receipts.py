"""
Nexus — Read Receipts Service
"""

from datetime import datetime, timezone
from uuid import UUID
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from models import Message, MessageReceipt, Participant
from messaging.websocket_manager import manager


class ReadReceiptsService:
    """
    Manages delivery and read receipt status transitions for messages.
    """

    async def mark_as_delivered(
        self, db: AsyncSession, message_ids: list[UUID], user_id: UUID
    ) -> None:
        """Mark a batch of messages as 'delivered' for a specific user and broadcast to others."""
        if not message_ids:
            return

        # Update receipt status in DB
        await db.execute(
            update(MessageReceipt)
            .where(
                MessageReceipt.message_id.in_(message_ids),
                MessageReceipt.user_id == user_id,
                MessageReceipt.status == "sent",
            )
            .values(status="delivered", updated_at=datetime.now(timezone.utc))
        )
        await db.commit()

        # Fetch conversation IDs for each message to broadcast updates
        result = await db.execute(
            select(Message.id, Message.conversation_id).where(Message.id.in_(message_ids))
        )
        msg_conv_map = {row[0]: row[1] for row in result.all()}

        for m_uuid in message_ids:
            conv_uuid = msg_conv_map.get(m_uuid)
            if conv_uuid:
                # Get participant IDs for broadcast
                p_res = await db.execute(
                    select(Participant.user_id).where(Participant.conversation_id == conv_uuid)
                )
                participant_ids = [str(row[0]) for row in p_res.all()]

                await manager.broadcast_to_conversation(
                    participant_ids,
                    {
                        "event": "message_delivered",
                        "conversation_id": str(conv_uuid),
                        "message_id": str(m_uuid),
                        "user_id": str(user_id),
                    }
                )

    async def mark_as_read(
        self, db: AsyncSession, conversation_id: UUID, user_id: UUID, up_to_message_id: UUID
    ) -> None:
        """Mark all messages up to up_to_message_id as 'read' (seen) for a user and broadcast."""
        # 1. Fetch the target message
        target_msg_res = await db.execute(
            select(Message).where(Message.id == up_to_message_id)
        )
        target_msg = target_msg_res.scalar_one_or_none()
        if not target_msg:
            return

        # 2. Find and update all receipts that are created before or at the same time
        receipts_res = await db.execute(
            select(MessageReceipt)
            .join(Message, Message.id == MessageReceipt.message_id)
            .where(
                Message.conversation_id == conversation_id,
                MessageReceipt.user_id == user_id,
                MessageReceipt.status != "read",
                Message.created_at <= target_msg.created_at,
            )
        )
        receipts_to_read = receipts_res.scalars().all()
        updated_msg_ids = []

        for r in receipts_to_read:
            r.status = "read"
            r.updated_at = datetime.now(timezone.utc)
            updated_msg_ids.append(str(r.message_id))

        await db.commit()

        # 3. Get all participant IDs for the conversation
        p_res = await db.execute(
            select(Participant.user_id).where(Participant.conversation_id == conversation_id)
        )
        participant_ids = [str(row[0]) for row in p_res.all()]

        # 4. Broadcast read receipts to conversation participants
        await manager.broadcast_to_conversation(
            participant_ids,
            {
                "event": "read_receipt",
                "conversation_id": str(conversation_id),
                "user_id": str(user_id),
                "message_id": str(up_to_message_id),
            },
            exclude=str(user_id),
        )

        # Broadcast the new message_read event for each updated message
        for msg_id in updated_msg_ids:
            await manager.broadcast_to_conversation(
                participant_ids,
                {
                    "event": "message_read",
                    "conversation_id": str(conversation_id),
                    "message_id": msg_id,
                    "user_id": str(user_id),
                }
            )


read_receipts_service = ReadReceiptsService()
