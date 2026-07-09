"""
Nexus — Message Delivery Engine
"""

from typing import Optional, List
from uuid import UUID
from sqlalchemy.ext.asyncio import AsyncSession
from messaging.websocket_manager import manager


class DeliveryEngine:
    """
    Manages real-time delivery routing, offline fallback buffering, and push queuing.
    """

    async def dispatch_message(
        self,
        db: AsyncSession,
        sender_id: UUID,
        conversation_id: UUID,
        message_id: UUID,
        message_type: str,
        content: Optional[str],
        message_payload: dict,
        recipient_ids: List[str]
    ) -> List[str]:
        """
        Dispatches message payload to conversation participants.
        If recipient is offline or on another node, enqueues the message and queues a push notification.
        Returns the list of user IDs that received the message in real-time.
        """
        delivered_uids = []
        for uid in recipient_ids:
            if uid == str(sender_id):
                continue

            # Send directly over WebSocket if locally connected, otherwise buffer offline
            success = await manager.send_to_user(uid, message_payload)
            if success:
                delivered_uids.append(uid)
            else:
                # User is offline (or connected on another process node)
                # Queue a mobile push notification using the existing worker
                from routers.chat import enqueue_notification
                try:
                    await enqueue_notification(
                        db,
                        sender_id,
                        conversation_id,
                        message_id,
                        message_type,
                        content
                    )
                except Exception as e:
                    print(f"[DeliveryEngine] Failed to enqueue push notification for {uid}: {e}")

        return delivered_uids


delivery_engine = DeliveryEngine()
