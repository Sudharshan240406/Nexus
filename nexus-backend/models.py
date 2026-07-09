"""
Nexus — SQLAlchemy ORM Models

Tables
──────
  users              Registered users with phone-based identity
  conversations      Direct (1-on-1) or group chats
  participants       Many-to-many link between users ↔ conversations
  messages           Individual messages inside a conversation
  message_reactions  Per-user emoji reactions on messages
"""

import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Boolean,
    Column,
    String,
    Text,
    DateTime,
    ForeignKey,
    UniqueConstraint,
    Index,
    Integer,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import relationship, backref

from database import Base


# ── Helpers ──────────────────────────────────────────────────────────────────

def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


def _new_uuid():
    return uuid.uuid4()


# ── Users ────────────────────────────────────────────────────────────────────

class User(Base):
    __tablename__ = "users"

    id = Column(UUID(as_uuid=True), primary_key=True, default=_new_uuid)
    phone = Column(String(20), unique=True, nullable=False, index=True)
    display_name = Column(String(100), nullable=True)
    avatar_url = Column(Text, nullable=True)
    is_active = Column(Boolean, nullable=False, default=True)
    pin_hash = Column(String(200), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=True)

    @property
    def has_pin(self) -> bool:
        return bool(self.pin_hash)

    # Relationships
    participations = relationship(
        "Participant", back_populates="user", cascade="all, delete-orphan"
    )
    sent_messages = relationship(
        "Message", back_populates="sender", cascade="all, delete-orphan",
        foreign_keys="Message.sender_id"
    )
    reactions = relationship(
        "MessageReaction", back_populates="user", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<User {self.display_name} ({self.phone})>"


# ── Conversations ────────────────────────────────────────────────────────────

class Conversation(Base):
    __tablename__ = "conversations"

    id = Column(UUID(as_uuid=True), primary_key=True, default=_new_uuid)
    title = Column(String(200), nullable=True)
    is_group = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at = Column(DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=True)

    # Relationships
    participants = relationship(
        "Participant", back_populates="conversation", cascade="all, delete-orphan"
    )
    messages = relationship(
        "Message",
        back_populates="conversation",
        cascade="all, delete-orphan",
        order_by="Message.created_at.asc()",
        foreign_keys="Message.conversation_id",
    )

    def __repr__(self) -> str:
        kind = "group" if self.is_group else "direct"
        return f"<Conversation {kind} {self.id}>"


# ── Participants ─────────────────────────────────────────────────────────────

class Participant(Base):
    __tablename__ = "participants"

    id = Column(UUID(as_uuid=True), primary_key=True, default=_new_uuid)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    conversation_id = Column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    role = Column(String(20), nullable=False, default="member")
    joined_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    last_read_message_id = Column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="SET NULL"),
        nullable=True,
    )

    __table_args__ = (
        UniqueConstraint("user_id", "conversation_id", name="uq_conv_user"),
    )

    # Relationships
    user = relationship("User", back_populates="participations")
    conversation = relationship("Conversation", back_populates="participants")

    @property
    def display_name(self) -> str | None:
        if "user" in self.__dict__ and self.user:
            return self.user.display_name
        return None

    @property
    def avatar_url(self) -> str | None:
        if "user" in self.__dict__ and self.user:
            return self.user.avatar_url
        return None

    def __repr__(self) -> str:
        return f"<Participant user={self.user_id} conv={self.conversation_id}>"


# ── Messages ─────────────────────────────────────────────────────────────────

class Message(Base):
    __tablename__ = "messages"

    id = Column(UUID(as_uuid=True), primary_key=True, default=_new_uuid)
    conversation_id = Column(
        UUID(as_uuid=True),
        ForeignKey("conversations.id", ondelete="CASCADE"),
        nullable=False,
    )
    sender_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="SET NULL"),
        nullable=True,
    )
    content = Column(Text, nullable=True)
    message_type = Column(String(20), nullable=False, default="text")
    media_url = Column(String(500), nullable=True)
    is_deleted = Column(Boolean, nullable=False, default=False)
    is_edited = Column(Boolean, nullable=False, default=False)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    reply_to_message_id = Column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="SET NULL"),
        nullable=True,
    )
    is_pinned = Column(Boolean, nullable=False, default=False, index=True)
    pinned_at = Column(DateTime(timezone=True), nullable=True)
    is_forwarded = Column(Boolean, nullable=False, default=False, index=True)
    forwarded_from = Column(String(100), nullable=True)
    duration = Column(Integer, nullable=True)
    file_size = Column(Integer, nullable=True)
    mime_type = Column(String(100), nullable=True)
    encryption_version = Column(String(50), nullable=True)
    nonce = Column(String(200), nullable=True)
    message_counter = Column(Integer, nullable=True)
    algorithm = Column(String(50), nullable=True)
    sender_device_id = Column(String(100), nullable=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)

    __table_args__ = (
        Index("ix_msg_conv_created", "conversation_id", "created_at"),
        Index("ix_messages_conv_pinned", "conversation_id", "is_pinned"),
    )

    # Relationships
    conversation = relationship(
        "Conversation", back_populates="messages",
        foreign_keys=[conversation_id]
    )
    sender = relationship(
        "User", back_populates="sent_messages",
        foreign_keys=[sender_id]
    )
    reply_to = relationship(
        "Message",
        foreign_keys=[reply_to_message_id],
        remote_side="Message.id",
        uselist=False,
    )
    reactions = relationship(
        "MessageReaction", back_populates="message", cascade="all, delete-orphan"
    )
    receipts = relationship(
        "MessageReceipt", back_populates="message", cascade="all, delete-orphan"
    )

    @property
    def sender_name(self) -> str | None:
        if "sender" in self.__dict__ and self.sender:
            return self.sender.display_name
        return None

    @property
    def sender_avatar(self) -> str | None:
        if "sender" in self.__dict__ and self.sender:
            return self.sender.avatar_url
        return None

    def __repr__(self) -> str:
        return f"<Message {self.id} type={self.message_type}>"


# ── Message Reactions ────────────────────────────────────────────────────────

class MessageReaction(Base):
    __tablename__ = "message_reactions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=_new_uuid)
    message_id = Column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    emoji = Column(String(10), nullable=False)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)

    __table_args__ = (
        # One reaction per user per message
        UniqueConstraint("message_id", "user_id", name="uq_reaction_msg_user"),
        Index("ix_reaction_message_id", "message_id"),
    )

    # Relationships
    message = relationship("Message", back_populates="reactions")
    user = relationship("User", back_populates="reactions")

    def __repr__(self) -> str:
        return f"<MessageReaction msg={self.message_id} user={self.user_id} emoji={self.emoji}>"


# ── Message Receipts ─────────────────────────────────────────────────────────

class MessageReceipt(Base):
    __tablename__ = "message_receipts"

    id = Column(UUID(as_uuid=True), primary_key=True, default=_new_uuid)
    message_id = Column(
        UUID(as_uuid=True),
        ForeignKey("messages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    status = Column(String(20), default="sent", nullable=False, index=True)  # sent | delivered | read
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at = Column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    __table_args__ = (
        UniqueConstraint("message_id", "user_id", name="uq_message_user_receipt"),
    )

    # relationships
    message = relationship("Message", back_populates="receipts")
    user = relationship("User")

    def __repr__(self) -> str:
        return f"<MessageReceipt msg={self.message_id} user={self.user_id} status={self.status}>"


# ── Push Tokens ──────────────────────────────────────────────────────────────

class PushToken(Base):
    __tablename__ = "push_tokens"

    id = Column(UUID(as_uuid=True), primary_key=True, default=_new_uuid)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    token = Column(String(500), unique=True, nullable=False, index=True)
    platform = Column(String(20), nullable=False)  # web | android | ios
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at = Column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    user = relationship("User")

    def __repr__(self) -> str:
        return f"<PushToken user={self.user_id} platform={self.platform}>"


# ── Cryptographic Identity & Devices (E2EE Phase 1) ──────────────────────────

class Device(Base):
    __tablename__ = "devices"

    id = Column(UUID(as_uuid=True), primary_key=True, default=_new_uuid)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    device_id_str = Column(String(200), nullable=False)
    display_name = Column(String(200), nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at = Column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    # Relationships
    user = relationship("User", backref="devices")
    identity_key = relationship(
        "IdentityKey", back_populates="device", uselist=False, cascade="all, delete-orphan"
    )
    signed_prekeys = relationship(
        "SignedPrekey", back_populates="device", cascade="all, delete-orphan"
    )
    one_time_prekeys = relationship(
        "OneTimePrekey", back_populates="device", cascade="all, delete-orphan"
    )

    __table_args__ = (
        UniqueConstraint("user_id", "device_id_str", name="uq_device_user_id_str"),
    )

    def __repr__(self) -> str:
        return f"<Device user={self.user_id} name={self.display_name}>"


class IdentityKey(Base):
    __tablename__ = "identity_keys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=_new_uuid)
    device_id = Column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
        unique=True,
    )
    public_key = Column(String(500), nullable=False)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)

    device = relationship("Device", back_populates="identity_key")

    def __repr__(self) -> str:
        return f"<IdentityKey device={self.device_id}>"


class SignedPrekey(Base):
    __tablename__ = "signed_prekeys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=_new_uuid)
    device_id = Column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    public_key = Column(String(500), nullable=False)
    signature = Column(String(500), nullable=False)
    key_id = Column(Integer, nullable=False)
    is_active = Column(Boolean, nullable=False, default=True)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)

    device = relationship("Device", back_populates="signed_prekeys")

    def __repr__(self) -> str:
        return f"<SignedPrekey device={self.device_id} id={self.key_id}>"


class OneTimePrekey(Base):
    __tablename__ = "one_time_prekeys"

    id = Column(UUID(as_uuid=True), primary_key=True, default=_new_uuid)
    device_id = Column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    public_key = Column(String(500), nullable=False)
    key_id = Column(Integer, nullable=False)
    is_consumed = Column(Boolean, nullable=False, default=False)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)

    device = relationship("Device", back_populates="one_time_prekeys")

    def __repr__(self) -> str:
        return f"<OneTimePrekey device={self.device_id} id={self.key_id} consumed={self.is_consumed}>"


class DeviceSession(Base):
    __tablename__ = "device_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=_new_uuid)
    user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    device_id = Column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    peer_user_id = Column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    peer_device_id = Column(
        UUID(as_uuid=True),
        ForeignKey("devices.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    session_data = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=_utcnow, nullable=False)
    updated_at = Column(
        DateTime(timezone=True), default=_utcnow, onupdate=_utcnow, nullable=False
    )

    __table_args__ = (
        UniqueConstraint("device_id", "peer_device_id", name="uq_device_session_devices"),
    )

    def __repr__(self) -> str:
        return f"<DeviceSession user={self.user_id} peer_user={self.peer_user_id}>"

