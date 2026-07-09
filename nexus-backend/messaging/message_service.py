"""
Nexus — Message Service
"""

import time
from datetime import datetime, timezone
from typing import Dict, List, Optional
from uuid import UUID
from fastapi import HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from models import Message, MessageReceipt, Participant
from schemas import WSIncomingMessage


class RateLimiter:
    """
    In-memory Token Bucket rate limiter for user messaging.
    Allows up to 10 messages per 10 seconds (refill rate: 1 token/sec).
    """

    def __init__(self, capacity: int = 10, refill_rate: float = 1.0) -> None:
        self.capacity = capacity
        self.refill_rate = refill_rate
        # Map: user_id_str -> {"tokens": float, "last_refill": float}
        self._buckets: Dict[str, dict] = {}

    def check_rate_limit(self, user_id: str) -> None:
        """Check if a user is within their message rate limit. Raises HTTP 429 if exceeded."""
        uid_str = str(user_id)
        now = time.time()

        if uid_str not in self._buckets:
            self._buckets[uid_str] = {"tokens": float(self.capacity) - 1.0, "last_refill": now}
            return

        bucket = self._buckets[uid_str]
        elapsed = now - bucket["last_refill"]
        refill = elapsed * self.refill_rate
        bucket["tokens"] = min(self.capacity, bucket["tokens"] + refill)
        bucket["last_refill"] = now

        if bucket["tokens"] < 1.0:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded. Please wait before sending more messages."
            )

        bucket["tokens"] -= 1.0


class MessageService:
    """
    Orchestrates message creation, permissions, edits, deletes, and rate limiting.
    """

    def __init__(self) -> None:
        self._rate_limiter = RateLimiter()

    def check_rate_limit(self, user_id: UUID) -> None:
        """Rate limit incoming messages for a user."""
        self._rate_limiter.check_rate_limit(str(user_id))

    async def validate_membership(self, db: AsyncSession, user_id: UUID, conversation_id: UUID) -> None:
        """Ensure the user is a participant of the conversation."""
        result = await db.execute(
            select(Participant).where(
                Participant.conversation_id == conversation_id,
                Participant.user_id == user_id
            )
        )
        participant = result.scalar_one_or_none()
        if not participant:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="Not a participant of this conversation"
            )

    async def create_message(
        self,
        db: AsyncSession,
        sender_id: UUID,
        conversation_id: UUID,
        content: Optional[str] = None,
        message_type: str = "text",
        media_url: Optional[str] = None,
        reply_to_message_id: Optional[UUID] = None,
        duration: Optional[int] = None,
        file_size: Optional[int] = None,
        mime_type: Optional[str] = None,
        is_forwarded: bool = False,
        forwarded_from: Optional[str] = None,
        encryption_version: Optional[str] = None,
        nonce: Optional[str] = None,
        message_counter: Optional[int] = None,
        algorithm: Optional[str] = None,
        sender_device_id: Optional[str] = None
    ) -> Message:
        """Create a new message in the database and pre-populate message receipts."""
        # 1. Enforce rate limiting
        self.check_rate_limit(sender_id)

        # 2. Verify membership
        await self.validate_membership(db, sender_id, conversation_id)

        # 3. Create message entry
        msg = Message(
            conversation_id=conversation_id,
            sender_id=sender_id,
            content=content,
            message_type=message_type,
            media_url=media_url,
            reply_to_message_id=reply_to_message_id,
            duration=duration,
            file_size=file_size,
            mime_type=mime_type,
            is_forwarded=is_forwarded,
            forwarded_from=forwarded_from,
            encryption_version=encryption_version,
            nonce=nonce,
            message_counter=message_counter,
            algorithm=algorithm,
            sender_device_id=sender_device_id
        )
        db.add(msg)
        await db.flush()  # Populates msg.id

        # 4. Populate receipts for all OTHER participants of the conversation
        p_res = await db.execute(
            select(Participant.user_id).where(
                Participant.conversation_id == conversation_id,
                Participant.user_id != sender_id
            )
        )
        other_user_ids = [row[0] for row in p_res.all()]

        for r_user_id in other_user_ids:
            receipt = MessageReceipt(
                message_id=msg.id,
                user_id=r_user_id,
                status="sent"  # pending -> sent (once saved in DB)
            )
            db.add(receipt)

        await db.commit()
        return msg

    async def validate_ownership(self, db: AsyncSession, user_id: UUID, message_id: UUID) -> Message:
        """Ensure the message exists and belongs to the specified user."""
        result = await db.execute(
            select(Message).where(Message.id == message_id)
        )
        msg = result.scalar_one_or_none()
        if not msg:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Message not found"
            )
        if msg.sender_id != user_id:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You do not own this message"
            )
        return msg

    async def edit_message(self, db: AsyncSession, user_id: UUID, message_id: UUID, new_content: str) -> Message:
        """Edit an existing message content."""
        msg = await self.validate_ownership(db, user_id, message_id)
        msg.content = new_content
        msg.is_edited = True
        msg.edited_at = datetime.now(timezone.utc)
        await db.commit()
        return msg

    async def delete_message(self, db: AsyncSession, user_id: UUID, message_id: UUID) -> Message:
        """Soft-delete an existing message."""
        msg = await self.validate_ownership(db, user_id, message_id)
        msg.is_deleted = True
        msg.content = None
        msg.media_url = None
        await db.commit()
        return msg

    def encrypt_metadata(self, metadata: dict) -> str:
        """
        Placeholder/helper for encrypting metadata where appropriate.
        For Zero-Knowledge architecture, clients handle cryptographic encryption of payload,
        but we can obfuscate/base64-encode metadata logs on request.
        """
        import base64
        import json
        serialized = json.dumps(metadata)
        return base64.b64encode(serialized.encode("utf-8")).decode("utf-8")


message_service = MessageService()
