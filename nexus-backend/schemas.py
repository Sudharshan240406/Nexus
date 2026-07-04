"""
Nexus — Pydantic Request / Response Schemas
"""

from datetime import datetime
from typing import Optional, List
from uuid import UUID

from pydantic import BaseModel, Field


# ═══════════════════════════════════════════════════════════════════════════════
#  AUTH
# ═══════════════════════════════════════════════════════════════════════════════

class OTPRequest(BaseModel):
    phone: str = Field(..., min_length=10, max_length=20, examples=["+91-9999999901"])


class OTPVerify(BaseModel):
    phone: str = Field(..., min_length=10, max_length=20)
    otp: str = Field(..., min_length=6, max_length=6, examples=["123456"])


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user_id: str


# ═══════════════════════════════════════════════════════════════════════════════
#  USER / PROFILE
# ═══════════════════════════════════════════════════════════════════════════════

class ProfileUpdate(BaseModel):
    display_name: Optional[str] = Field(None, min_length=1, max_length=100)
    avatar_url: Optional[str] = None


class UserOut(BaseModel):
    id: UUID
    phone: str
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    is_active: bool = True
    has_pin: bool = False

    model_config = {"from_attributes": True}


# ═══════════════════════════════════════════════════════════════════════════════
#  CONVERSATION
# ═══════════════════════════════════════════════════════════════════════════════

class ConversationCreate(BaseModel):
    is_group: bool = False
    title: Optional[str] = None
    participant_ids: list[str] = Field(
        ...,
        min_length=1,
        description="List of user UUIDs to include (current user is added automatically)",
    )


class ParticipantOut(BaseModel):
    id: UUID
    user_id: UUID
    role: str = "member"
    joined_at: datetime
    display_name: Optional[str] = None
    avatar_url: Optional[str] = None
    is_online: bool = False
    last_seen: Optional[datetime] = None
    last_read_message_id: Optional[UUID] = None

    model_config = {"from_attributes": True}


class ConversationOut(BaseModel):
    id: UUID
    is_group: bool
    title: Optional[str] = None
    created_at: datetime
    participants: list[ParticipantOut] = []
    last_message: Optional["MessageOut"] = None

    model_config = {"from_attributes": True}


# ═══════════════════════════════════════════════════════════════════════════════
#  REACTIONS
# ═══════════════════════════════════════════════════════════════════════════════

class ReactionSummary(BaseModel):
    emoji: str
    count: int
    user_ids: List[str]


# ═══════════════════════════════════════════════════════════════════════════════
#  MESSAGE
# ═══════════════════════════════════════════════════════════════════════════════

class ReplyPreview(BaseModel):
    id: str
    sender_name: Optional[str] = None
    content: Optional[str] = None
    message_type: str = "text"


class MessageOut(BaseModel):
    id: UUID
    conversation_id: UUID
    sender_id: Optional[UUID] = None
    content: Optional[str] = None
    message_type: str = "text"
    media_url: Optional[str] = None
    is_deleted: bool = False
    is_edited: bool = False
    edited_at: Optional[datetime] = None
    reply_to_message_id: Optional[UUID] = None
    reply_to_preview: Optional[ReplyPreview] = None
    created_at: datetime
    sender_name: Optional[str] = None
    sender_avatar: Optional[str] = None
    reactions: List[ReactionSummary] = []
    status: Optional[str] = None
    duration: Optional[int] = None
    file_size: Optional[int] = None
    mime_type: Optional[str] = None
    is_pinned: bool = False
    is_forwarded: bool = False
    forwarded_from: Optional[str] = None

    model_config = {"from_attributes": True}


class ForwardMessageRequest(BaseModel):
    conversation_ids: list[UUID]


class MessageCreateRequest(BaseModel):
    content: Optional[str] = None
    message_type: str = "text"
    media_url: Optional[str] = None
    reply_to_message_id: Optional[UUID] = None
    duration: Optional[int] = None


class MessageUpdate(BaseModel):
    content: str = Field(..., min_length=1, max_length=10000)


class PaginatedMessages(BaseModel):
    messages: list[MessageOut]
    page: int
    page_size: int
    total: int
    has_more: bool


# ═══════════════════════════════════════════════════════════════════════════════
#  WEBSOCKET PAYLOADS
# ═══════════════════════════════════════════════════════════════════════════════

class WSIncomingMessage(BaseModel):
    """Payload the client sends over WebSocket to send a new message."""
    conversation_id: str
    content: Optional[str] = None
    message_type: str = "text"
    reply_to_message_id: Optional[str] = None
    media_url: Optional[str] = None
    duration: Optional[int] = None


class WSOutgoingMessage(BaseModel):
    """Payload the server pushes to clients."""
    event: str = "new_message"
    message: MessageOut


# ═══════════════════════════════════════════════════════════════════════════════
#  SECURITY / PIN
# ═══════════════════════════════════════════════════════════════════════════════

class SetPINRequest(BaseModel):
    pin: str = Field(..., min_length=4, max_length=6, pattern=r"^\d+$")


class VerifyPINRequest(BaseModel):
    pin: str = Field(..., min_length=4, max_length=6, pattern=r"^\d+$")


# ═══════════════════════════════════════════════════════════════════════════════
#  GROUP MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════

class ParticipantAdd(BaseModel):
    user_id: UUID


class ParticipantRoleUpdate(BaseModel):
    role: str = Field(..., pattern=r"^(admin|member)$")


# ═══════════════════════════════════════════════════════════════════════════════
#  PUSH NOTIFICATIONS
# ═══════════════════════════════════════════════════════════════════════════════

class PushTokenRegister(BaseModel):
    push_token: str
    platform: Optional[str] = None


class PushTokenOut(BaseModel):
    id: UUID
    user_id: UUID
    token: str
    platform: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ═══════════════════════════════════════════════════════════════════════════════
#  E2EE IDENTITY (v2.0 Phase 1)
# ═══════════════════════════════════════════════════════════════════════════════

class SignedPrekeySchema(BaseModel):
    public_key: str
    signature: str
    key_id: int


class OneTimePrekeySchema(BaseModel):
    public_key: str
    key_id: int


class DeviceRegisterRequest(BaseModel):
    device_id_str: str
    display_name: str
    identity_key: str
    signed_prekey: SignedPrekeySchema
    one_time_prekeys: list[OneTimePrekeySchema] = []


class DeviceOut(BaseModel):
    id: UUID
    user_id: UUID
    device_id_str: str
    display_name: str
    is_active: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class PrekeyBundleDeviceOut(BaseModel):
    device_id: UUID
    device_id_str: str
    display_name: str
    identity_key: str
    signed_prekey: SignedPrekeySchema
    one_time_prekey: Optional[OneTimePrekeySchema] = None


class PrekeyBundleOut(BaseModel):
    user_id: UUID
    devices: list[PrekeyBundleDeviceOut]


class KeyRotateRequest(BaseModel):
    signed_prekey: Optional[SignedPrekeySchema] = None
    one_time_prekeys: Optional[list[OneTimePrekeySchema]] = None


# ═══════════════════════════════════════════════════════════════════════════════
#  E2EE SESSIONS (v2.0 Phase 2)
# ═══════════════════════════════════════════════════════════════════════════════

class DeviceSessionCreate(BaseModel):
    peer_user_id: UUID
    peer_device_id: UUID
    session_data: str
    peer_session_data: Optional[str] = None


class DeviceSessionOut(BaseModel):
    id: UUID
    user_id: UUID
    device_id: UUID
    peer_user_id: UUID
    peer_device_id: UUID
    session_data: str
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DeviceSessionStatusOut(BaseModel):
    id: UUID
    peer_user_id: UUID
    peer_device_id: UUID
    is_expired: bool
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# Rebuild forward refs
ConversationOut.model_rebuild()


