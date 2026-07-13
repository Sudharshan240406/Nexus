"""
Nexus — Chat Router

REST Endpoints
──────────────
  GET    /conversations                              List all conversations
  POST   /conversations                              Create a direct or group conversation
  GET    /conversations/{id}/messages                Paginated message history
  GET    /conversations/{id}/messages/search?q=     Search messages
  PUT    /profile                                    Update display name / avatar
  PUT    /messages/{id}                              Edit own text message
  DELETE /messages/{id}                             Soft-delete own message
  POST   /messages/{id}/reactions                   Add/toggle reaction
  DELETE /messages/{id}/reactions/{emoji}            Remove reaction
  POST   /upload/media                              Upload image or audio file

WebSocket
─────────
  WS  /ws/{user_id}?token=<JWT>   Real-time messaging channel

  Incoming event types:
    (no event field)  → new_message
    typing            → broadcast typing to conversation
    mark_read         → update last_read_message_id
    add_reaction      → upsert reaction, broadcast reaction_updated
    remove_reaction   → delete reaction, broadcast reaction_updated
    edit_message      → update content, broadcast message_edited
    delete_message    → soft delete, broadcast message_deleted
"""

import json
from collections import defaultdict
from datetime import datetime, timezone
from uuid import UUID
from typing import Optional
import httpx

from fastapi import (
    APIRouter,
    Depends,
    HTTPException,
    Query,
    Request,
    WebSocket,
    WebSocketDisconnect,
    status,
    UploadFile,
    File,
    Form,
)
from sqlalchemy import func, select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload, joinedload
import os
import shutil
import uuid

from database import async_session, get_db
from models import Conversation, Message, MessageReaction, Participant, User, MessageReceipt, PushToken
from routers.auth import decode_access_token
from schemas import (
    ConversationCreate,
    ConversationOut,
    MessageOut,
    MessageUpdate,
    PaginatedMessages,
    ParticipantOut,
    ProfileUpdate,
    ReactionSummary,
    ReplyPreview,
    UserOut,
    WSIncomingMessage,
    ParticipantAdd,
    ParticipantRoleUpdate,
    PushTokenRegister,
    PushTokenOut,
    ForwardMessageRequest,
    MessageCreateRequest,
)
from services.websocket_manager import manager

router = APIRouter(tags=["chat"])


# ═══════════════════════════════════════════════════════════════════════════════
#  HELPERS
# ═══════════════════════════════════════════════════════════════════════════════

def _get_current_user_id(request: Request) -> str:
    """Extract user_id that was injected by the JWT middleware."""
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user_id


def _build_reaction_summary(reactions: list) -> list[ReactionSummary]:
    """Aggregate raw reaction rows into emoji → count/users summary."""
    agg: dict[str, list[str]] = defaultdict(list)
    for r in reactions:
        agg[r.emoji].append(str(r.user_id))
    return [
        ReactionSummary(emoji=emoji, count=len(uids), user_ids=uids)
        for emoji, uids in agg.items()
    ]


async def _build_message_out(msg: Message) -> MessageOut:
    """Build a full MessageOut including reactions and reply preview."""
    reactions = _build_reaction_summary(msg.reactions if msg.reactions else [])

    reply_preview = None
    if msg.reply_to_message_id and msg.reply_to:
        rm = msg.reply_to
        reply_preview = ReplyPreview(
            id=str(rm.id),
            sender_name=rm.sender_name,
            content=rm.content if not rm.is_deleted else None,
            message_type=rm.message_type,
        )

    # Status computation: minimum of other participants' receipts
    status_map = {"sent": 1, "delivered": 2, "read": 3}
    inv_status_map = {1: "sent", 2: "delivered", 3: "read"}
    other_receipts = [r for r in (msg.receipts or []) if r.user_id != msg.sender_id]
    if not other_receipts:
        msg_status = "sent"
    else:
        min_val = min(status_map.get(r.status, 1) for r in other_receipts)
        msg_status = inv_status_map[min_val]

    return MessageOut(
        id=msg.id,
        conversation_id=msg.conversation_id,
        sender_id=msg.sender_id,
        content=msg.content,
        message_type=msg.message_type,
        media_url=msg.media_url,
        is_deleted=msg.is_deleted,
        is_edited=msg.is_edited,
        edited_at=msg.edited_at,
        reply_to_message_id=msg.reply_to_message_id,
        reply_to_preview=reply_preview,
        created_at=msg.created_at,
        sender_name=msg.sender_name,
        sender_avatar=msg.sender_avatar,
        reactions=reactions,
        status=msg_status,
        duration=msg.duration,
        file_size=msg.file_size,
        mime_type=msg.mime_type,
        is_pinned=bool(getattr(msg, "is_pinned", False)),
        is_forwarded=bool(getattr(msg, "is_forwarded", False)),
        forwarded_from=getattr(msg, "forwarded_from", None),
        encryption_version=msg.encryption_version,
        nonce=msg.nonce,
        message_counter=msg.message_counter,
        algorithm=msg.algorithm,
        sender_device_id=msg.sender_device_id,
    )


async def _get_participant_ids(db: AsyncSession, conversation_id: UUID) -> list[str]:
    result = await db.execute(
        select(Participant.user_id).where(Participant.conversation_id == conversation_id)
    )
    return [str(row[0]) for row in result.all()]


async def enqueue_notification(
    db: AsyncSession,
    sender_id: UUID,
    conversation_id: UUID,
    message_id: UUID,
    message_type: str,
    content: Optional[str]
):
    try:
        # Load conversation
        conv_res = await db.execute(
            select(Conversation)
            .options(
                selectinload(Conversation.participants)
                .joinedload(Participant.user)
            )
            .where(Conversation.id == conversation_id)
        )
        conv = conv_res.scalar_one_or_none()
        if not conv:
            return

        # Load sender
        sender_res = await db.execute(select(User).where(User.id == sender_id))
        sender = sender_res.scalar_one_or_none()
        sender_name = sender.display_name if (sender and sender.display_name) else (sender.phone if sender else "Unknown")

        # Determine notification title
        if conv.is_group:
            title = conv.title or "Group Message"
            title = f"{sender_name} @ {title}"
        else:
            title = sender_name

        # Determine notification body
        if message_type == "enc_text":
            body = "🔒 Encrypted message"
        elif message_type == "enc_image":
            body = "🔒 Encrypted photo"
        elif message_type == "enc_audio":
            body = "🔒 Encrypted voice note"
        elif message_type == "enc_video":
            body = "🔒 Encrypted video"
        elif message_type == "enc_document":
            body = "🔒 Encrypted document"
        elif message_type == "text":
            body = content or ""
        elif message_type == "image":
            body = "📷 Photo"
        elif message_type == "audio":
            body = "🎵 Voice note"
        elif message_type == "gif":
            body = "👾 GIF"
        else:
            body = "Sent a message"

        # Limit body length
        if body and len(body) > 100:
            body = body[:97] + "..."

        # Queue jobs
        for p in conv.participants:
            uid_str = str(p.user_id)
            if p.user_id == sender_id:
                continue

            is_online = await manager.is_online(uid_str)
            is_viewing = manager.is_user_viewing_chat(uid_str, str(conversation_id))

            if not is_online or not is_viewing:
                job = {
                    "user_id": uid_str,
                    "title": title,
                    "body": body,
                    "conversation_id": str(conversation_id),
                    "message_id": str(message_id),
                    "type": "message",
                    "retries": 0
                }
                if manager._redis:
                    await manager._redis.rpush("nexus:notifications", json.dumps(job))
    except Exception as e:
        print(f"ENQUEUE NOTIFICATION ERROR: {e}")



# ═══════════════════════════════════════════════════════════════════════════════
#  PROFILE
# ═══════════════════════════════════════════════════════════════════════════════

@router.put("/profile", response_model=UserOut)
async def update_profile(
    body: ProfileUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Update the current user's display name and/or avatar URL."""
    user_id = _get_current_user_id(request)

    result = await db.execute(select(User).where(User.id == UUID(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if body.display_name is not None:
        user.display_name = body.display_name
    if body.avatar_url is not None:
        user.avatar_url = body.avatar_url

    await db.flush()
    await db.refresh(user)
    return user


@router.get("/users/search", response_model=UserOut)
async def search_user_by_phone(
    request: Request,
    phone: str = Query(..., min_length=10, max_length=20),
    db: AsyncSession = Depends(get_db),
):
    """Find a user by phone number. Returns 404 if not found."""
    _get_current_user_id(request)
    result = await db.execute(select(User).where(User.phone == phone))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="No Nexus user with that number",
        )
    return user


@router.get("/users/{user_id}/status")
async def get_user_status(
    user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Get online presence and last active time of a user."""
    _get_current_user_id(request)
    result = await db.execute(select(User).where(User.id == UUID(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found",
        )
    is_online = await manager.is_online(user_id)
    return {
        "user_id": user.id,
        "is_online": is_online,
        "last_seen": user.updated_at,
    }


# ═══════════════════════════════════════════════════════════════════════════════
#  CONVERSATIONS
# ═══════════════════════════════════════════════════════════════════════════════

@router.get("/conversations", response_model=list[ConversationOut])
async def list_conversations(
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Return every conversation the current user participates in."""
    user_id = _get_current_user_id(request)

    conv_ids_q = (
        select(Participant.conversation_id)
        .where(Participant.user_id == UUID(user_id))
        .subquery()
    )

    result = await db.execute(
        select(Conversation)
        .where(Conversation.id.in_(select(conv_ids_q.c.conversation_id)))
        .options(selectinload(Conversation.participants).joinedload(Participant.user))
        .order_by(Conversation.created_at.desc())
    )
    conversations = result.scalars().unique().all()

    all_user_ids = []
    for conv in conversations:
        for p in conv.participants:
            all_user_ids.append(str(p.user_id))
    online_user_ids = set(await manager.get_online_users(all_user_ids))

    output: list[ConversationOut] = []
    for conv in conversations:
        last_msg_result = await db.execute(
            select(Message)
            .options(
                joinedload(Message.sender),
                selectinload(Message.receipts),
            )
            .where(Message.conversation_id == conv.id)
            .order_by(Message.created_at.desc())
            .limit(1)
        )
        last_msg = last_msg_result.scalar_one_or_none()

        participants_out = []
        for p in conv.participants:
            participants_out.append(
                ParticipantOut(
                    id=p.id,
                    user_id=p.user_id,
                    role=p.role,
                    joined_at=p.joined_at,
                    display_name=p.display_name,
                    avatar_url=p.avatar_url,
                    is_online=str(p.user_id) in online_user_ids,
                    last_seen=p.user.updated_at if p.user else None,
                    last_read_message_id=p.last_read_message_id,
                )
            )

        last_msg_out = None
        if last_msg:
            last_msg_out = MessageOut(
                id=last_msg.id,
                conversation_id=last_msg.conversation_id,
                sender_id=last_msg.sender_id,
                content=last_msg.content,
                message_type=last_msg.message_type,
                media_url=last_msg.media_url,
                is_deleted=last_msg.is_deleted,
                is_edited=last_msg.is_edited,
                edited_at=last_msg.edited_at,
                reply_to_message_id=last_msg.reply_to_message_id,
                created_at=last_msg.created_at,
                sender_name=last_msg.sender_name,
                sender_avatar=last_msg.sender_avatar,
            )

        conv_out = ConversationOut(
            id=conv.id,
            is_group=conv.is_group,
            title=conv.title,
            created_at=conv.created_at,
            participants=participants_out,
            last_message=last_msg_out,
        )
        output.append(conv_out)

    return output


@router.post(
    "/conversations",
    response_model=ConversationOut,
    status_code=status.HTTP_201_CREATED,
)
async def create_conversation(
    body: ConversationCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Create a new direct or group conversation."""
    user_id = _get_current_user_id(request)

    all_participant_ids = list(set(body.participant_ids + [user_id]))

    if not body.is_group and len(all_participant_ids) != 2:
        raise HTTPException(
            status_code=400,
            detail="Direct conversations must have exactly 2 participants",
        )

    if not body.is_group:
        other_id = [pid for pid in all_participant_ids if pid != user_id][0]
        existing = await _find_direct_conversation(db, user_id, other_id)
        if existing:
            participant_user_ids = [str(p.user_id) for p in existing.participants]
            online_user_ids = set(await manager.get_online_users(participant_user_ids))
            participants_out = []
            for p in existing.participants:
                participants_out.append(
                    ParticipantOut(
                        id=p.id,
                        user_id=p.user_id,
                        role=p.role,
                        joined_at=p.joined_at,
                        display_name=p.display_name,
                        avatar_url=p.avatar_url,
                        is_online=str(p.user_id) in online_user_ids,
                        last_seen=p.user.updated_at if p.user else None,
                        last_read_message_id=p.last_read_message_id,
                    )
                )
            return ConversationOut(
                id=existing.id,
                is_group=existing.is_group,
                title=existing.title,
                created_at=existing.created_at,
                participants=participants_out,
            )

    for pid in all_participant_ids:
        result = await db.execute(select(User).where(User.id == UUID(pid)))
        if not result.scalar_one_or_none():
            raise HTTPException(status_code=404, detail=f"User {pid} not found")

    conv = Conversation(is_group=body.is_group, title=body.title)
    db.add(conv)
    await db.flush()

    for pid in all_participant_ids:
        role = "admin" if (body.is_group and pid == user_id) else "member"
        db.add(Participant(conversation_id=conv.id, user_id=UUID(pid), role=role))
    await db.flush()

    await db.refresh(conv)
    result = await db.execute(
        select(Conversation)
        .where(Conversation.id == conv.id)
        .options(selectinload(Conversation.participants).joinedload(Participant.user))
    )
    conv = result.scalar_one()

    participant_user_ids = [str(p.user_id) for p in conv.participants]
    online_user_ids = set(await manager.get_online_users(participant_user_ids))
    participants_out = []
    for p in conv.participants:
        participants_out.append(
            ParticipantOut(
                id=p.id,
                user_id=p.user_id,
                role=p.role,
                joined_at=p.joined_at,
                display_name=p.display_name,
                avatar_url=p.avatar_url,
                is_online=str(p.user_id) in online_user_ids,
                last_seen=p.user.updated_at if p.user else None,
                last_read_message_id=p.last_read_message_id,
            )
        )

    return ConversationOut(
        id=conv.id,
        is_group=conv.is_group,
        title=conv.title,
        created_at=conv.created_at,
        participants=participants_out,
    )


async def _find_direct_conversation(
    db: AsyncSession, user_a: str, user_b: str
) -> Conversation | None:
    """Find an existing direct conversation between two users."""
    a_convs = (
        select(Participant.conversation_id)
        .where(Participant.user_id == UUID(user_a))
        .subquery()
    )
    result = await db.execute(
        select(Conversation)
        .join(Participant, Participant.conversation_id == Conversation.id)
        .where(
            Conversation.id.in_(select(a_convs.c.conversation_id)),
            Participant.user_id == UUID(user_b),
            Conversation.is_group == False,
        )
        .options(selectinload(Conversation.participants).joinedload(Participant.user))
        .limit(1)
    )
    return result.scalar_one_or_none()


# ═══════════════════════════════════════════════════════════════════════════════
#  MESSAGES
# ═══════════════════════════════════════════════════════════════════════════════

@router.get(
    "/conversations/{conversation_id}/messages",
    response_model=PaginatedMessages,
)
async def get_messages(
    conversation_id: str,
    request: Request,
    page: int = Query(1, ge=1),
    page_size: int = Query(50, ge=1, le=100),
    db: AsyncSession = Depends(get_db),
):
    """Return paginated messages for a conversation (newest first)."""
    user_id = _get_current_user_id(request)
    conv_uuid = UUID(conversation_id)

    result = await db.execute(
        select(Participant).where(
            Participant.conversation_id == conv_uuid,
            Participant.user_id == UUID(user_id),
        )
    )
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Not a member of this conversation")

    # Mark all unread messages in this conversation for current user as READ
    unread_receipts_result = await db.execute(
        select(MessageReceipt)
        .join(Message, Message.id == MessageReceipt.message_id)
        .where(
            Message.conversation_id == conv_uuid,
            MessageReceipt.user_id == UUID(user_id),
            MessageReceipt.status != "read"
        )
    )
    unread_receipts = unread_receipts_result.scalars().all()
    if unread_receipts:
        updated_msg_ids = []
        for r in unread_receipts:
            r.status = "read"
            r.updated_at = datetime.now(timezone.utc)
            updated_msg_ids.append(str(r.message_id))
        await db.commit()

        # Broadcast message_read event for each marked message to other participants
        p_result = await db.execute(
            select(Participant.user_id).where(Participant.conversation_id == conv_uuid)
        )
        p_ids = [str(row[0]) for row in p_result.all()]
        for msg_id in updated_msg_ids:
            await manager.broadcast_to_conversation(
                p_ids,
                {
                    "event": "message_read",
                    "conversation_id": conversation_id,
                    "message_id": msg_id,
                    "user_id": user_id
                }
            )

    count_result = await db.execute(
        select(func.count()).select_from(Message).where(
            Message.conversation_id == conv_uuid
        )
    )
    total = count_result.scalar()

    offset = (page - 1) * page_size
    result = await db.execute(
        select(Message)
        .options(
            joinedload(Message.sender),
            joinedload(Message.reactions).joinedload(MessageReaction.user),
            joinedload(Message.reply_to).joinedload(Message.sender),
            selectinload(Message.receipts),
        )
        .where(Message.conversation_id == conv_uuid)
        .order_by(Message.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    messages = result.scalars().unique().all()

    msgs_out = []
    for m in messages:
        msgs_out.append(await _build_message_out(m))

    return PaginatedMessages(
        messages=msgs_out,
        page=page,
        page_size=page_size,
        total=total,
        has_more=(offset + page_size) < total,
    )


@router.get("/conversations/{conversation_id}/messages/search")
async def search_messages(
    conversation_id: str,
    request: Request,
    q: str = Query(..., min_length=1, max_length=200),
    db: AsyncSession = Depends(get_db),
):
    """Search messages in a conversation by content (case-insensitive)."""
    user_id = _get_current_user_id(request)
    conv_uuid = UUID(conversation_id)

    part_result = await db.execute(
        select(Participant).where(
            Participant.conversation_id == conv_uuid,
            Participant.user_id == UUID(user_id),
        )
    )
    if not part_result.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Not a member of this conversation")

    result = await db.execute(
        select(Message)
        .options(
            joinedload(Message.sender),
            selectinload(Message.receipts),
        )
        .where(
            Message.conversation_id == conv_uuid,
            Message.is_deleted == False,
            Message.content.ilike(f"%{q}%"),
        )
        .order_by(Message.created_at.desc())
        .limit(50)
    )
    messages = result.scalars().unique().all()

    msgs_out = []
    for m in messages:
        msgs_out.append(await _build_message_out(m))

    return {"messages": msgs_out, "query": q, "count": len(msgs_out)}


@router.put("/messages/{message_id}")
async def edit_message(
    message_id: str,
    body: MessageUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Edit own text message."""
    user_id = _get_current_user_id(request)
    msg_uuid = UUID(message_id)

    result = await db.execute(
        select(Message)
        .options(joinedload(Message.sender), joinedload(Message.reactions))
        .where(Message.id == msg_uuid)
    )
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if str(msg.sender_id) != user_id:
        raise HTTPException(status_code=403, detail="Cannot edit another user's message")
    if msg.is_deleted:
        raise HTTPException(status_code=400, detail="Cannot edit a deleted message")
    if msg.message_type != "text":
        raise HTTPException(status_code=400, detail="Only text messages can be edited")

    msg.content = body.content
    msg.is_edited = True
    msg.edited_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(msg, ["sender", "reactions"])

    msg_out = await _build_message_out(msg)

    # Broadcast to conversation
    participant_ids = await _get_participant_ids(db, msg.conversation_id)
    await manager.broadcast_to_conversation(
        participant_ids,
        {"event": "message_edited", "message": msg_out.model_dump(mode="json")},
    )
    return msg_out


@router.delete("/messages/{message_id}")
async def delete_message(
    message_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    """Soft-delete own message."""
    user_id = _get_current_user_id(request)
    msg_uuid = UUID(message_id)

    result = await db.execute(select(Message).where(Message.id == msg_uuid))
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")
    if str(msg.sender_id) != user_id:
        raise HTTPException(status_code=403, detail="Cannot delete another user's message")

    msg.is_deleted = True
    msg.content = None
    msg.media_url = None
    await db.commit()

    participant_ids = await _get_participant_ids(db, msg.conversation_id)
    await manager.broadcast_to_conversation(
        participant_ids,
        {
            "event": "message_deleted",
            "message_id": str(msg_uuid),
            "conversation_id": str(msg.conversation_id),
        },
    )
    return {"message": "Message deleted"}


@router.post("/messages/{message_id}/reactions")
async def add_reaction(
    message_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db),
    emoji: str = Query(..., min_length=1, max_length=10),
):
    """Add or toggle a reaction on a message. One reaction per user per message."""
    user_id = _get_current_user_id(request)
    msg_uuid = UUID(message_id)

    result = await db.execute(select(Message).where(Message.id == msg_uuid))
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    # Check existing reaction for this user
    existing = await db.execute(
        select(MessageReaction).where(
            MessageReaction.message_id == msg_uuid,
            MessageReaction.user_id == UUID(user_id),
        )
    )
    existing_reaction = existing.scalar_one_or_none()

    if existing_reaction:
        if existing_reaction.emoji == emoji:
            # Toggle off (remove)
            await db.delete(existing_reaction)
        else:
            # Change emoji
            existing_reaction.emoji = emoji
    else:
        db.add(MessageReaction(
            message_id=msg_uuid,
            user_id=UUID(user_id),
            emoji=emoji,
        ))

    await db.commit()

    # Reload reactions
    result = await db.execute(
        select(MessageReaction).where(MessageReaction.message_id == msg_uuid)
    )
    all_reactions = result.scalars().all()
    summary = _build_reaction_summary(all_reactions)

    participant_ids = await _get_participant_ids(db, msg.conversation_id)
    await manager.broadcast_to_conversation(
        participant_ids,
        {
            "event": "reaction_updated",
            "message_id": str(msg_uuid),
            "conversation_id": str(msg.conversation_id),
            "reactions": [r.model_dump() for r in summary],
        },
    )
    return {"reactions": summary}


# ── REPLY, FORWARD AND PINNED MESSAGES ────────────────────────────────────────

@router.post("/conversations/{conversation_id}/messages", response_model=MessageOut, status_code=status.HTTP_201_CREATED)
async def send_rest_message(
    conversation_id: str,
    body: MessageCreateRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    user_id = _get_current_user_id(request)
    try:
        conv_uuid = UUID(conversation_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid conversation ID format")
    
    # Check if participant
    p_check = await db.execute(
        select(Participant).where(
            Participant.conversation_id == conv_uuid,
            Participant.user_id == UUID(user_id)
        )
    )
    if not p_check.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Not a member of this conversation")

    # Set up file size and mime type if it's media or audio
    file_size_val = None
    mime_type_val = None
    if body.message_type == "audio" and body.media_url:
        filename_only = body.media_url.replace("/media/", "")
        local_path = os.path.join("uploads", filename_only)
        if os.path.exists(local_path):
            file_size_val = os.path.getsize(local_path)
            import mimetypes
            guessed = mimetypes.guess_type(local_path)[0]
            if guessed:
                mime_type_val = guessed

    msg = Message(
        conversation_id=conv_uuid,
        sender_id=UUID(user_id),
        content=body.content,
        message_type=body.message_type,
        media_url=body.media_url,
        reply_to_message_id=body.reply_to_message_id,
        duration=body.duration,
        file_size=file_size_val,
        mime_type=mime_type_val,
    )
    db.add(msg)
    await db.flush()

    # Create receipts
    p_result = await db.execute(
        select(Participant.user_id).where(
            Participant.conversation_id == conv_uuid,
            Participant.user_id != UUID(user_id)
        )
    )
    other_p_ids = [row[0] for row in p_result.all()]
    for p_id in other_p_ids:
        db.add(MessageReceipt(message_id=msg.id, user_id=p_id, status="sent"))
    
    await db.commit()

    # Reload message with relationships
    result = await db.execute(
        select(Message)
        .options(
            joinedload(Message.sender),
            selectinload(Message.reactions),
            selectinload(Message.receipts),
            joinedload(Message.reply_to).joinedload(Message.sender),
        )
        .where(Message.id == msg.id)
    )
    msg = result.scalar_one()
    msg_out = await _build_message_out(msg)

    # Broadcast to WS
    ws_payload = {
        "event": "new_message",
        "message": msg_out.model_dump(mode="json"),
    }
    participant_ids = [str(uid) for uid in other_p_ids + [UUID(user_id)]]
    delivered_uids = await manager.broadcast_to_conversation(
        participant_ids, ws_payload, exclude=user_id
    )

    # Trigger push notifications
    await enqueue_notification(
        db,
        UUID(user_id),
        conv_uuid,
        msg.id,
        body.message_type,
        body.content
    )

    # Update delivered status if applicable
    if delivered_uids:
        await db.execute(
            update(MessageReceipt)
            .where(
                MessageReceipt.message_id == msg.id,
                MessageReceipt.user_id.in_([UUID(uid) for uid in delivered_uids])
            )
            .values(status="delivered", updated_at=datetime.now(timezone.utc))
        )
        await db.commit()
        for uid in delivered_uids:
            await manager.broadcast_to_conversation(
                participant_ids,
                {
                    "event": "message_delivered",
                    "conversation_id": conversation_id,
                    "message_id": str(msg.id),
                    "user_id": uid
                }
            )

    return msg_out


@router.post("/messages/{message_id}/forward", response_model=list[MessageOut])
async def forward_message(
    message_id: str,
    body: ForwardMessageRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    user_id = _get_current_user_id(request)
    try:
        msg_uuid = UUID(message_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid message ID format")

    # Load original message
    orig_result = await db.execute(
        select(Message)
        .options(joinedload(Message.sender))
        .where(Message.id == msg_uuid)
    )
    orig = orig_result.scalar_one_or_none()
    if not orig:
        raise HTTPException(status_code=404, detail="Original message not found")

    # Verify user has access to original message's conversation
    p_check_orig = await db.execute(
        select(Participant).where(
            Participant.conversation_id == orig.conversation_id,
            Participant.user_id == UUID(user_id)
        )
    )
    if not p_check_orig.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="No access to the original message's conversation")

    sender_name = "Unknown"
    if orig.sender:
        sender_name = orig.sender.display_name or orig.sender.phone

    created_outs = []

    for target_conv_id in body.conversation_ids:
        # Check target participant
        p_check_target = await db.execute(
            select(Participant).where(
                Participant.conversation_id == target_conv_id,
                Participant.user_id == UUID(user_id)
            )
        )
        if not p_check_target.scalar_one_or_none():
            # Skip conversations the user is not a member of
            continue

        new_msg = Message(
            conversation_id=target_conv_id,
            sender_id=UUID(user_id),
            content=orig.content,
            message_type=orig.message_type,
            media_url=orig.media_url,
            is_forwarded=True,
            forwarded_from=sender_name,
            duration=orig.duration,
            file_size=orig.file_size,
            mime_type=orig.mime_type,
        )
        db.add(new_msg)
        await db.flush()

        # Create receipts for other participants in target conversation
        p_result = await db.execute(
            select(Participant.user_id).where(
                Participant.conversation_id == target_conv_id,
                Participant.user_id != UUID(user_id)
            )
        )
        other_p_ids = [row[0] for row in p_result.all()]
        for p_id in other_p_ids:
            db.add(MessageReceipt(message_id=new_msg.id, user_id=p_id, status="sent"))

        await db.commit()

        # Reload with relationships
        reload_result = await db.execute(
            select(Message)
            .options(
                joinedload(Message.sender),
                selectinload(Message.reactions),
                selectinload(Message.receipts),
                joinedload(Message.reply_to).joinedload(Message.sender),
            )
            .where(Message.id == new_msg.id)
        )
        new_msg = reload_result.scalar_one()
        msg_out = await _build_message_out(new_msg)
        created_outs.append(msg_out)

        # Broadcast WS Event to target conversation members
        ws_payload = {
            "event": "new_message",
            "message": msg_out.model_dump(mode="json"),
        }
        participant_ids = [str(uid) for uid in other_p_ids + [UUID(user_id)]]
        delivered_uids = await manager.broadcast_to_conversation(
            participant_ids, ws_payload, exclude=user_id
        )

        # Enqueue Push Notifications
        await enqueue_notification(
            db,
            UUID(user_id),
            target_conv_id,
            new_msg.id,
            new_msg.message_type,
            new_msg.content
        )

        # Update delivered status
        if delivered_uids:
            await db.execute(
                update(MessageReceipt)
                .where(
                    MessageReceipt.message_id == new_msg.id,
                    MessageReceipt.user_id.in_([UUID(uid) for uid in delivered_uids])
                )
                .values(status="delivered", updated_at=datetime.now(timezone.utc))
            )
            await db.commit()
            for uid in delivered_uids:
                await manager.broadcast_to_conversation(
                    participant_ids,
                    {
                        "event": "message_delivered",
                        "conversation_id": str(target_conv_id),
                        "message_id": str(new_msg.id),
                        "user_id": uid
                    }
                )

    return created_outs


@router.post("/messages/{message_id}/pin", response_model=MessageOut)
async def pin_message(
    message_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    user_id = _get_current_user_id(request)
    try:
        msg_uuid = UUID(message_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid message ID format")

    result = await db.execute(select(Message).where(Message.id == msg_uuid))
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    # Check participant permissions
    p_check = await db.execute(
        select(Participant).where(
            Participant.conversation_id == msg.conversation_id,
            Participant.user_id == UUID(user_id)
        )
    )
    if not p_check.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Not a member of this conversation")

    msg.is_pinned = True
    msg.pinned_at = datetime.now(timezone.utc)
    await db.commit()

    # Reload message with relationships
    reload_result = await db.execute(
        select(Message)
        .options(
            joinedload(Message.sender),
            selectinload(Message.reactions),
            selectinload(Message.receipts),
            joinedload(Message.reply_to).joinedload(Message.sender),
        )
        .where(Message.id == msg.id)
    )
    msg = reload_result.scalar_one()
    msg_out = await _build_message_out(msg)

    # Broadcast WebSocket Event
    p_result = await db.execute(
        select(Participant.user_id).where(Participant.conversation_id == msg.conversation_id)
    )
    p_ids = [str(row[0]) for row in p_result.all()]
    await manager.broadcast_to_conversation(
        p_ids,
        {
            "event": "message_pinned",
            "conversation_id": str(msg.conversation_id),
            "message": msg_out.model_dump(mode="json"),
        }
    )

    return msg_out


@router.post("/messages/{message_id}/unpin", response_model=MessageOut)
async def unpin_message(
    message_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    user_id = _get_current_user_id(request)
    try:
        msg_uuid = UUID(message_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid message ID format")

    result = await db.execute(select(Message).where(Message.id == msg_uuid))
    msg = result.scalar_one_or_none()
    if not msg:
        raise HTTPException(status_code=404, detail="Message not found")

    # Check participant permissions
    p_check = await db.execute(
        select(Participant).where(
            Participant.conversation_id == msg.conversation_id,
            Participant.user_id == UUID(user_id)
        )
    )
    if not p_check.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Not a member of this conversation")

    msg.is_pinned = False
    msg.pinned_at = None
    await db.commit()

    # Reload message with relationships
    reload_result = await db.execute(
        select(Message)
        .options(
            joinedload(Message.sender),
            selectinload(Message.reactions),
            selectinload(Message.receipts),
            joinedload(Message.reply_to).joinedload(Message.sender),
        )
        .where(Message.id == msg.id)
    )
    msg = reload_result.scalar_one()
    msg_out = await _build_message_out(msg)

    # Broadcast WebSocket Event
    p_result = await db.execute(
        select(Participant.user_id).where(Participant.conversation_id == msg.conversation_id)
    )
    p_ids = [str(row[0]) for row in p_result.all()]
    await manager.broadcast_to_conversation(
        p_ids,
        {
            "event": "message_unpinned",
            "conversation_id": str(msg.conversation_id),
            "message_id": str(msg.id),
        }
    )

    return msg_out


@router.get("/conversations/{conversation_id}/pins", response_model=list[MessageOut])
async def get_pinned_messages(
    conversation_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    user_id = _get_current_user_id(request)
    try:
        conv_uuid = UUID(conversation_id)
    except Exception:
        raise HTTPException(status_code=400, detail="Invalid conversation ID format")

    # Check participant permissions
    p_check = await db.execute(
        select(Participant).where(
            Participant.conversation_id == conv_uuid,
            Participant.user_id == UUID(user_id)
        )
    )
    if not p_check.scalar_one_or_none():
        raise HTTPException(status_code=403, detail="Not a member of this conversation")

    # Fetch pinned messages
    result = await db.execute(
        select(Message)
        .options(
            joinedload(Message.sender),
            selectinload(Message.reactions),
            selectinload(Message.receipts),
            joinedload(Message.reply_to).joinedload(Message.sender),
        )
        .where(Message.conversation_id == conv_uuid, Message.is_pinned == True)
        .order_by(Message.pinned_at.desc())
    )
    pins = result.scalars().unique().all()

    pinned_outs = []
    for p in pins:
        pinned_outs.append(await _build_message_out(p))

    return pinned_outs


# ═══════════════════════════════════════════════════════════════════════════════
#  MEDIA UPLOAD
# ═══════════════════════════════════════════════════════════════════════════════

_ALLOWED_EXTENSIONS = {
    # Images
    ".jpg", ".jpeg", ".png", ".gif", ".webp",
    # Audio
    ".webm", ".ogg", ".mp3", ".m4a", ".opus", ".wav",
}
_ALLOWED_MIME_TYPES = {
    "image/jpeg", "image/png", "image/gif", "image/webp",
    "audio/webm", "audio/ogg", "audio/mpeg", "audio/mp4",
    "audio/opus", "audio/wav", "video/webm",
}

@router.post("/upload/media", status_code=status.HTTP_201_CREATED)
async def upload_media(
    request: Request,
    file: UploadFile = File(...),
    conversation_id: Optional[str] = Form(None),
    duration: Optional[float] = Form(None),
    reply_to_message_id: Optional[str] = Form(None),
    encryption_version: Optional[str] = Form(None),
    nonce: Optional[str] = Form(None),
    message_counter: Optional[int] = Form(None),
    algorithm: Optional[str] = Form(None),
    sender_device_id: Optional[str] = Form(None),
    content: Optional[str] = Form(None),
    db: AsyncSession = Depends(get_db)
):
    """Upload an image or audio file and return its static URL or audio message details."""
    user_id = _get_current_user_id(request)

    os.makedirs("uploads", exist_ok=True)

    # 1. Size & Extension validation using AttachmentService
    file.file.seek(0, 2)
    file_size = file.file.tell()
    file.file.seek(0)

    from messaging import attachment_service
    category = attachment_service.validate_file(file, file_size)

    filename = file.filename or "upload"
    ext = os.path.splitext(filename)[1].lower()
    mime_type = file.content_type
    is_audio = (category == "audio")

    if is_audio:
        if not conversation_id:
            raise HTTPException(
                status_code=400,
                detail="conversation_id is required for audio message uploads."
            )
        try:
            conv_uuid = UUID(conversation_id)
        except ValueError:
            raise HTTPException(
                status_code=400,
                detail="Invalid conversation_id UUID format."
            )

        # Verify participant membership
        p_check = await db.execute(
            select(Participant).where(
                Participant.conversation_id == conv_uuid,
                Participant.user_id == UUID(user_id)
            )
        )
        if not p_check.scalar_one_or_none():
            raise HTTPException(
                status_code=403,
                detail="Not a member of this conversation."
            )

    # Save the file
    unique_filename = f"{uuid.uuid4()}{ext}"
    file_path = os.path.join("uploads", unique_filename)

    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    media_url = f"/media/{unique_filename}"

    if is_audio:
        reply_to_id = None
        if reply_to_message_id:
            try:
                reply_to_id = UUID(reply_to_message_id)
            except ValueError:
                pass

        # Create message in database
        msg_type_val = "enc_audio" if encryption_version else "audio"
        msg = Message(
            conversation_id=UUID(conversation_id),
            sender_id=UUID(user_id),
            content=content if encryption_version else None,
            message_type=msg_type_val,
            media_url=media_url,
            reply_to_message_id=reply_to_id,
            duration=int(round(duration)) if duration is not None else 0,
            file_size=file_size,
            mime_type=mime_type,
            encryption_version=encryption_version,
            nonce=nonce,
            message_counter=message_counter,
            algorithm=algorithm,
            sender_device_id=sender_device_id
        )
        db.add(msg)
        await db.flush()

        # Create receipts
        p_result = await db.execute(
            select(Participant.user_id).where(
                Participant.conversation_id == msg.conversation_id,
                Participant.user_id != msg.sender_id
            )
        )
        other_p_ids = [row[0] for row in p_result.all()]

        for p_id in other_p_ids:
            db.add(MessageReceipt(
                message_id=msg.id,
                user_id=p_id,
                status="sent"
            ))
        await db.commit()

        # Reload with relationships
        result = await db.execute(
            select(Message)
            .options(
                joinedload(Message.sender),
                selectinload(Message.reactions),
                selectinload(Message.receipts),
                joinedload(Message.reply_to).joinedload(Message.sender),
            )
            .where(Message.id == msg.id)
        )
        msg = result.scalar_one()
        msg_out = await _build_message_out(msg)

        # Broadcast 'new_message' to all participants of this conversation EXCEPT the sender
        participant_ids = await _get_participant_ids(db, msg.conversation_id)
        delivered_uids = await manager.broadcast_to_conversation(
            participant_ids,
            {
                "event": "new_message",
                "message": msg_out.model_dump(mode="json"),
            },
            exclude=user_id
        )

        await enqueue_notification(
            db,
            UUID(user_id),
            msg.conversation_id,
            msg.id,
            msg.message_type,
            None
        )

        # Send confirmation to the sender over WS
        await manager.send_to_user(
            user_id,
            {
                "event": "message_sent",
                "message": msg_out.model_dump(mode="json"),
            }
        )

        if delivered_uids:
            await db.execute(
                update(MessageReceipt)
                .where(
                    MessageReceipt.message_id == msg.id,
                    MessageReceipt.user_id.in_([UUID(uid) for uid in delivered_uids])
                )
                .values(status="delivered", updated_at=datetime.now(timezone.utc))
            )
            await db.commit()

            for uid in delivered_uids:
                await manager.broadcast_to_conversation(
                    participant_ids,
                    {
                        "event": "message_delivered",
                        "conversation_id": str(msg.conversation_id),
                        "message_id": str(msg.id),
                        "user_id": uid
                    }
                )

        return {
            "id": str(msg.id),
            "media_url": media_url,
            "duration": msg.duration,
            "message_type": msg.message_type
        }

    return {"media_url": media_url}


# ── GIPHY PROXY ──────────────────────────────────────────────────────────────

_MOCK_GIFS = [
    {
        "id": "gif_1",
        "title": "Funny Cat Typing",
        "url": "https://i.giphy.com/3oriO0OEd9QIDdllqo.gif",
        "keywords": ["cat", "typing", "work", "coding"]
    },
    {
        "id": "gif_2",
        "title": "Minions Celebrate",
        "url": "https://i.giphy.com/26tOZ42cXx35dPg2Y.gif",
        "keywords": ["celebrate", "party", "happy", "minions", "dance"]
    },
    {
        "id": "gif_3",
        "title": "Thank You Wave",
        "url": "https://i.giphy.com/3o85xH5n58q7aE1uW0.gif",
        "keywords": ["thank you", "thanks", "wave", "dog"]
    },
    {
        "id": "gif_4",
        "title": "Cute Dog Hello",
        "url": "https://i.giphy.com/3o6gb2QV3f1AYkqKgc.gif",
        "keywords": ["hello", "wave", "dog", "cute", "hi"]
    },
    {
        "id": "gif_5",
        "title": "LeBron James Facepalm",
        "url": "https://i.giphy.com/3wog5D9cMTlM4.gif",
        "keywords": ["facepalm", "lebron", "basketball", "silly"]
    },
    {
        "id": "gif_6",
        "title": "Office High Five",
        "url": "https://i.giphy.com/l0amJzR3yvPFC1kkE.gif",
        "keywords": ["high five", "success", "yes", "office"]
    },
    {
        "id": "gif_7",
        "title": "Cat Jumping Excitement",
        "url": "https://i.giphy.com/11xV3LhD4P9Q5y.gif",
        "keywords": ["cat", "happy", "jump", "excited"]
    },
    {
        "id": "gif_8",
        "title": "Homer Simpson Backs Into Bush",
        "url": "https://i.giphy.com/COYGe9rZvfiaQ.gif",
        "keywords": ["homer", "simpsons", "hide", "back away", "bush"]
    },
    {
        "id": "gif_9",
        "title": "Dog Coding Confused",
        "url": "https://i.giphy.com/H507GCOf9vNs4.gif",
        "keywords": ["dog", "coding", "computer", "confused"]
    },
    {
        "id": "gif_10",
        "title": "SpongeBob Rainbow Imagination",
        "url": "https://i.giphy.com/QIqKBjufRLJWw.gif",
        "keywords": ["rainbow", "spongebob", "imagination", "happy"]
    }
]

def _format_mock_gif(gif: dict) -> dict:
    return {
        "id": gif["id"],
        "title": gif["title"],
        "images": {
            "fixed_height_small": {
                "url": gif["url"]
            },
            "downsized": {
                "url": gif["url"]
            }
        }
    }

@router.get("/gifs/trending")
async def get_gifs_trending(limit: int = Query(20, ge=1, le=50)):
    giphy_key = os.getenv("GIPHY_API_KEY", "dc6zaTOxFJmzC")
    url = f"https://api.giphy.com/v1/gifs/trending?api_key={giphy_key}&limit={limit}&rating=g"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(url, timeout=4.0)
            if res.status_code == 200:
                return res.json()
    except Exception as e:
        print(f"GIPHY trending proxy error: {e}")
    
    return {"data": [_format_mock_gif(g) for g in _MOCK_GIFS[:limit]]}

@router.get("/gifs/search")
async def get_gifs_search(q: str = Query("", max_length=200), limit: int = Query(20, ge=1, le=50)):
    giphy_key = os.getenv("GIPHY_API_KEY", "dc6zaTOxFJmzC")
    url = f"https://api.giphy.com/v1/gifs/search?api_key={giphy_key}&q={q}&limit={limit}&rating=g"
    try:
        async with httpx.AsyncClient() as client:
            res = await client.get(url, timeout=4.0)
            if res.status_code == 200:
                return res.json()
    except Exception as e:
        print(f"GIPHY search proxy error: {e}")
    
    q_lower = q.lower().strip()
    if not q_lower:
        return {"data": [_format_mock_gif(g) for g in _MOCK_GIFS[:limit]]}
        
    matches = []
    for g in _MOCK_GIFS:
        if q_lower in g["title"].lower() or any(q_lower in kw for kw in g["keywords"]):
            matches.append(_format_mock_gif(g))
    if not matches:
        matches = [_format_mock_gif(g) for g in _MOCK_GIFS]
    return {"data": matches[:limit]}


# ═══════════════════════════════════════════════════════════════════════════════
#  GROUP PARTICIPANT MANAGEMENT
# ═══════════════════════════════════════════════════════════════════════════════

@router.post("/conversations/{conversation_id}/participants")
async def add_participant(
    conversation_id: str,
    body: ParticipantAdd,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Add a new participant to a group conversation (admin only)."""
    user_id = _get_current_user_id(request)
    conv_uuid = UUID(conversation_id)

    admin_check = await db.execute(
        select(Participant).where(
            Participant.conversation_id == conv_uuid,
            Participant.user_id == UUID(user_id)
        )
    )
    admin_p = admin_check.scalar_one_or_none()
    if not admin_p or admin_p.role != "admin":
        raise HTTPException(status_code=403, detail="Only conversation admins can add members")

    target_check = await db.execute(select(User).where(User.id == body.user_id))
    target_user = target_check.scalar_one_or_none()
    if not target_user:
        raise HTTPException(status_code=404, detail="User not found")

    exists_check = await db.execute(
        select(Participant).where(
            Participant.conversation_id == conv_uuid,
            Participant.user_id == body.user_id
        )
    )
    if exists_check.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="User is already a participant")

    new_p = Participant(conversation_id=conv_uuid, user_id=body.user_id, role="member")
    db.add(new_p)
    await db.commit()

    return {"message": "Participant added successfully"}


@router.delete("/conversations/{conversation_id}/participants/{target_user_id}")
async def remove_participant(
    conversation_id: str,
    target_user_id: str,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Remove a participant or leave the conversation (admin only, or self-leave)."""
    user_id = _get_current_user_id(request)
    conv_uuid = UUID(conversation_id)
    target_uuid = UUID(target_user_id)

    curr_check = await db.execute(
        select(Participant).where(
            Participant.conversation_id == conv_uuid,
            Participant.user_id == UUID(user_id)
        )
    )
    curr_p = curr_check.scalar_one_or_none()
    if not curr_p:
        raise HTTPException(status_code=403, detail="Not a participant of this conversation")

    is_self = (user_id == target_user_id)

    if not is_self and curr_p.role != "admin":
        raise HTTPException(status_code=403, detail="Only admins can remove other members")

    target_check = await db.execute(
        select(Participant).where(
            Participant.conversation_id == conv_uuid,
            Participant.user_id == target_uuid
        )
    )
    target_p = target_check.scalar_one_or_none()
    if not target_p:
        raise HTTPException(status_code=404, detail="Target participant not found")

    await db.delete(target_p)
    await db.commit()

    return {"message": "Participant removed successfully" if not is_self else "Left conversation successfully"}


@router.put("/conversations/{conversation_id}/participants/{target_user_id}/role")
async def update_participant_role(
    conversation_id: str,
    target_user_id: str,
    body: ParticipantRoleUpdate,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Promote or demote a participant (admin only)."""
    user_id = _get_current_user_id(request)
    conv_uuid = UUID(conversation_id)
    target_uuid = UUID(target_user_id)

    curr_check = await db.execute(
        select(Participant).where(
            Participant.conversation_id == conv_uuid,
            Participant.user_id == UUID(user_id)
        )
    )
    curr_p = curr_check.scalar_one_or_none()
    if not curr_p or curr_p.role != "admin":
        raise HTTPException(status_code=403, detail="Only admins can promote/demote other members")

    target_check = await db.execute(
        select(Participant).where(
            Participant.conversation_id == conv_uuid,
            Participant.user_id == target_uuid
        )
    )
    target_p = target_check.scalar_one_or_none()
    if not target_p:
        raise HTTPException(status_code=404, detail="Target participant not found")

    target_p.role = body.role
    await db.commit()

    return {"message": f"Role updated to {body.role} successfully"}


# ═══════════════════════════════════════════════════════════════════════════════
#  PUSH NOTIFICATIONS
# ═══════════════════════════════════════════════════════════════════════════════

async def check_rate_limit(user_id: str, limit: int = 20, window: int = 60) -> bool:
    """Rate limit: allow at most `limit` registrations per `window` seconds."""
    if not manager._redis:
        return True
    key = f"nexus:ratelimit:push-token:{user_id}"
    try:
        count = await manager._redis.incr(key)
        if count == 1:
            await manager._redis.expire(key, window)
        if count > limit:
            return False
    except Exception as e:
        print(f"Rate limit check error: {e}")
    return True


@router.post("/push-token", response_model=PushTokenOut)
async def register_push_token(
    body: PushTokenRegister,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """Register or update a push token for the authenticated user."""
    user_id = _get_current_user_id(request)

    # Apply rate limiting
    if not await check_rate_limit(user_id):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many push token registration requests"
        )

    token = body.push_token.strip()
    if not token:
        raise HTTPException(status_code=400, detail="Token cannot be empty")

    # Detect platform
    platform = body.platform
    if not platform:
        if token.startswith("ExponentPushToken"):
            platform = "android"
        elif "endpoint" in token:
            platform = "web"
        else:
            platform = "web"

    # Validate platform
    if platform not in ("web", "android", "ios"):
        raise HTTPException(status_code=400, detail="Invalid platform. Must be 'web', 'android', or 'ios'")

    # Validate token ownership and duplicates
    stmt = select(PushToken).where(PushToken.token == token)
    result = await db.execute(stmt)
    existing = result.scalar_one_or_none()

    if existing:
        existing.user_id = UUID(user_id)
        existing.platform = platform
        existing.updated_at = datetime.now(timezone.utc)
        await db.commit()
        await db.refresh(existing)
        return existing
    else:
        new_token = PushToken(
            id=uuid.uuid4(),
            user_id=UUID(user_id),
            token=token,
            platform=platform,
            created_at=datetime.now(timezone.utc),
            updated_at=datetime.now(timezone.utc)
        )
        db.add(new_token)
        await db.commit()
        await db.refresh(new_token)
        return new_token


@router.delete("/push-token")
async def remove_push_token(
    request: Request,
    token: str = Query(..., description="The push token to delete"),
    db: AsyncSession = Depends(get_db)
):
    """Remove an active push token."""
    user_id = _get_current_user_id(request)
    stmt = delete(PushToken).where(
        PushToken.token == token,
        PushToken.user_id == UUID(user_id)
    )
    res = await db.execute(stmt)
    await db.commit()
    if res.rowcount == 0:
         raise HTTPException(status_code=404, detail="Token not found for this user")
    return {"message": "Push token removed successfully"}


@router.get("/push-token", response_model=list[PushTokenOut])
async def list_push_tokens(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """List active push tokens for the authenticated user."""
    user_id = _get_current_user_id(request)
    stmt = select(PushToken).where(PushToken.user_id == UUID(user_id))
    result = await db.execute(stmt)
    return result.scalars().all()



# ═══════════════════════════════════════════════════════════════════════════════
#  WEBSOCKET — /ws/{user_id}?token=<JWT>
# ═══════════════════════════════════════════════════════════════════════════════

@router.websocket("/ws/{user_id}")
async def websocket_endpoint(websocket: WebSocket, user_id: str):
    """
    Real-time messaging channel.

    Incoming event types (JSON field "event"):
      (none / new_message)  → save & broadcast new message
      typing                → broadcast typing indicator
      mark_read             → update last_read_message_id, broadcast read_receipt
      add_reaction          → upsert reaction, broadcast reaction_updated
      remove_reaction       → delete reaction, broadcast reaction_updated
      edit_message          → update content, broadcast message_edited
      delete_message        → soft delete, broadcast message_deleted
    """

    # ── 1. Authenticate ──────────────────────────────────────────────────
    token = websocket.query_params.get("token")
    if not token:
        await websocket.close(code=4001, reason="Missing auth token")
        return

    try:
        payload = decode_access_token(token)
    except Exception:
        await websocket.close(code=4001, reason="Invalid auth token")
        return

    token_user_id = payload.get("sub")
    if token_user_id != user_id:
        await websocket.close(code=4003, reason="Token user mismatch")
        return

    # ── 2. Connect & mark online ─────────────────────────────────────────
    async def on_offline_delivered(recipient_id: str, payloads: list[dict]):
        msg_ids = []
        for p in payloads:
            if p.get("event") == "new_message" and "message" in p:
                try:
                    msg_ids.append(UUID(p["message"]["id"]))
                except Exception:
                    pass
        if msg_ids:
            try:
                async with async_session() as db_session:
                    await db_session.execute(
                        update(MessageReceipt)
                        .where(
                            MessageReceipt.message_id.in_(msg_ids),
                            MessageReceipt.user_id == UUID(recipient_id),
                            MessageReceipt.status == "sent",
                        )
                        .values(status="delivered", updated_at=datetime.now(timezone.utc))
                    )
                    await db_session.commit()

                    # Fetch conversation IDs for each message
                    result = await db_session.execute(
                        select(Message.id, Message.conversation_id).where(Message.id.in_(msg_ids))
                    )
                    msg_conv_map = {row[0]: row[1] for row in result.all()}

                    for m_uuid in msg_ids:
                        conv_uuid = msg_conv_map.get(m_uuid)
                        if conv_uuid:
                            p_ids = await _get_participant_ids(db_session, conv_uuid)
                            await manager.broadcast_to_conversation(
                                p_ids,
                                {
                                    "event": "message_delivered",
                                    "conversation_id": str(conv_uuid),
                                    "message_id": str(m_uuid),
                                    "user_id": recipient_id,
                                }
                            )
            except Exception as e:
                print(f"Error in on_offline_delivered database sync: {e}")

    await manager.connect(user_id, websocket, on_delivered_callback=on_offline_delivered)

    try:
        now_utc = datetime.now(timezone.utc)
        async with async_session() as db:
            await db.execute(
                update(User)
                .where(User.id == UUID(user_id))
                .values(updated_at=now_utc)
            )
            await db.commit()

            conv_ids_q = (
                select(Participant.conversation_id)
                .where(Participant.user_id == UUID(user_id))
                .subquery()
            )
            result = await db.execute(
                select(Participant.user_id).where(
                    Participant.conversation_id.in_(select(conv_ids_q.c.conversation_id))
                )
            )
            all_related_participants = list(set(str(row[0]) for row in result.all()))

        presence_payload = {
            "event": "user_presence",
            "user_id": user_id,
            "is_online": True,
            "last_seen": now_utc.isoformat(),
        }
        await manager.broadcast_to_conversation(
            all_related_participants, presence_payload, exclude=user_id
        )
    except Exception as e:
        import traceback
        traceback.print_exc()
        print(f"WS CONNECT BROADCAST ERROR: {e}")

    try:
        # ── 3. Message loop ──────────────────────────────────────────────
        while True:
            raw = await websocket.receive_text()

            try:
                data = json.loads(raw)
            except Exception:
                await websocket.send_json({"event": "error", "detail": "Invalid JSON format"})
                continue

            event_type = data.get("event")

            # ── Enter Conversation ────────────────────────────────────────
            if event_type == "enter_conversation":
                conv_id = data.get("conversation_id")
                if conv_id:
                    manager.enter_conversation(user_id, conv_id)
                continue

            # ── Leave Conversation ────────────────────────────────────────
            if event_type == "leave_conversation":
                manager.leave_conversation(user_id)
                continue

            # ── Typing indicator ──────────────────────────────────────────
            if event_type == "typing":
                conv_id = data.get("conversation_id")
                if not conv_id:
                    continue
                from messaging import typing_manager
                typing_manager.set_typing(user_id, conv_id)
                typing_users = typing_manager.get_typing_users(conv_id)
                async with async_session() as db:
                    result = await db.execute(
                        select(Participant.user_id).where(
                            Participant.conversation_id == UUID(conv_id)
                        )
                    )
                    participant_ids = [str(row[0]) for row in result.all()]
                await manager.broadcast_to_conversation(
                    participant_ids,
                    {
                        "event": "typing",
                        "conversation_id": conv_id,
                        "user_id": user_id,
                        "typing_users": typing_users
                    },
                    exclude=user_id,
                )
                continue

            # ── Mark read ─────────────────────────────────────────────────
            if event_type == "mark_read":
                conv_id = data.get("conversation_id")
                up_to_msg_id = data.get("message_id")
                if not conv_id or not up_to_msg_id:
                    continue
                try:
                    async with async_session() as db:
                        # 1. Update Participant last_read_message_id (legacy)
                        await db.execute(
                            update(Participant)
                            .where(
                                Participant.conversation_id == UUID(conv_id),
                                Participant.user_id == UUID(user_id),
                            )
                            .values(last_read_message_id=UUID(up_to_msg_id))
                        )
                        from messaging import read_receipts_service
                        await read_receipts_service.mark_as_read(db, UUID(conv_id), UUID(user_id), UUID(up_to_msg_id))
                except Exception as e:
                    print(f"MARK_READ ERROR: {e}")
                continue

            # ── Add/toggle reaction (via WS) ──────────────────────────────
            if event_type == "add_reaction":
                conv_id = data.get("conversation_id")
                msg_id = data.get("message_id")
                emoji = data.get("emoji")
                if not all([conv_id, msg_id, emoji]):
                    continue
                try:
                    async with async_session() as db:
                        msg_uuid = UUID(msg_id)
                        existing = await db.execute(
                            select(MessageReaction).where(
                                MessageReaction.message_id == msg_uuid,
                                MessageReaction.user_id == UUID(user_id),
                            )
                        )
                        existing_reaction = existing.scalar_one_or_none()
                        if existing_reaction:
                            if existing_reaction.emoji == emoji:
                                await db.delete(existing_reaction)
                            else:
                                existing_reaction.emoji = emoji
                        else:
                            db.add(MessageReaction(
                                message_id=msg_uuid,
                                user_id=UUID(user_id),
                                emoji=emoji,
                            ))
                        await db.commit()

                        result = await db.execute(
                            select(MessageReaction).where(MessageReaction.message_id == msg_uuid)
                        )
                        all_reactions = result.scalars().all()
                        summary = _build_reaction_summary(all_reactions)

                        participant_ids = await _get_participant_ids(db, UUID(conv_id))

                    await manager.broadcast_to_conversation(
                        participant_ids,
                        {
                            "event": "reaction_updated",
                            "message_id": msg_id,
                            "conversation_id": conv_id,
                            "reactions": [r.model_dump() for r in summary],
                        },
                    )
                except Exception as e:
                    print(f"ADD_REACTION ERROR: {e}")
                continue

            # ── Edit message (via WS) ─────────────────────────────────────
            if event_type == "edit_message":
                conv_id = data.get("conversation_id")
                msg_id = data.get("message_id")
                new_content = data.get("content")
                if not all([conv_id, msg_id, new_content]):
                    continue
                try:
                    async with async_session() as db:
                        msg_uuid = UUID(msg_id)
                        result = await db.execute(
                            select(Message)
                            .options(joinedload(Message.sender), selectinload(Message.reactions))
                            .where(Message.id == msg_uuid)
                        )
                        msg = result.scalar_one_or_none()
                        if not msg or str(msg.sender_id) != user_id:
                            continue
                        msg.content = new_content
                        msg.is_edited = True
                        msg.edited_at = datetime.now(timezone.utc)
                        await db.commit()
                        await db.refresh(msg, ["sender", "reactions"])
                        msg_out = await _build_message_out(msg)
                        participant_ids = await _get_participant_ids(db, UUID(conv_id))

                    await manager.broadcast_to_conversation(
                        participant_ids,
                        {"event": "message_edited", "message": msg_out.model_dump(mode="json")},
                    )
                except Exception as e:
                    print(f"EDIT_MESSAGE ERROR: {e}")
                continue

            # ── Delete message (via WS) ───────────────────────────────────
            if event_type == "delete_message":
                conv_id = data.get("conversation_id")
                msg_id = data.get("message_id")
                if not all([conv_id, msg_id]):
                    continue
                try:
                    async with async_session() as db:
                        msg_uuid = UUID(msg_id)
                        result = await db.execute(
                            select(Message).where(Message.id == msg_uuid)
                        )
                        msg = result.scalar_one_or_none()
                        if not msg or str(msg.sender_id) != user_id:
                            continue
                        msg.is_deleted = True
                        msg.content = None
                        msg.media_url = None
                        await db.commit()
                        participant_ids = await _get_participant_ids(db, UUID(conv_id))

                    await manager.broadcast_to_conversation(
                        participant_ids,
                        {
                            "event": "message_deleted",
                            "message_id": msg_id,
                            "conversation_id": conv_id,
                        },
                    )
                except Exception as e:
                    print(f"DELETE_MESSAGE ERROR: {e}")
                continue

            # ── New message (default) ─────────────────────────────────────
            try:
                incoming = WSIncomingMessage(**data)
            except Exception:
                await websocket.send_json({"event": "error", "detail": "Invalid message format"})
                continue

            try:
                media_url = incoming.media_url
                content_val = incoming.content
                if not media_url and incoming.message_type in ("image", "audio", "gif"):
                    media_url = incoming.content
                    content_val = None

                reply_to_id = None
                if incoming.reply_to_message_id:
                    try:
                        reply_to_id = UUID(incoming.reply_to_message_id)
                    except Exception:
                        pass

                duration_val = incoming.duration
                file_size_val = None
                mime_type_val = None

                if media_url:
                    filename_only = media_url.replace("/media/", "")
                    local_path = os.path.join("uploads", filename_only)
                    if os.path.exists(local_path):
                        file_size_val = os.path.getsize(local_path)
                        import mimetypes
                        guessed = mimetypes.guess_type(local_path)[0]
                        if guessed:
                            mime_type_val = guessed
                        else:
                            ext = os.path.splitext(filename_only)[1].lower()
                            if ext == ".webm":
                                mime_type_val = "audio/webm"
                            elif ext == ".ogg":
                                mime_type_val = "audio/ogg"
                            elif ext == ".mp3":
                                mime_type_val = "audio/mpeg"
                            elif ext == ".m4a":
                                mime_type_val = "audio/mp4"
                            elif ext == ".wav":
                                mime_type_val = "audio/wav"
                            elif ext == ".pdf":
                                mime_type_val = "application/pdf"

                from messaging import message_service, delivery_engine, read_receipts_service

                async with async_session() as db:
                    conv_uuid = UUID(incoming.conversation_id)
                    
                    # Create message (validates membership, rate limit, and creates sent receipts)
                    msg = await message_service.create_message(
                        db=db,
                        sender_id=UUID(user_id),
                        conversation_id=conv_uuid,
                        content=content_val,
                        message_type=incoming.message_type,
                        media_url=media_url,
                        reply_to_message_id=reply_to_id,
                        duration=duration_val,
                        file_size=file_size_val,
                        mime_type=mime_type_val,
                        encryption_version=incoming.encryption_version,
                        nonce=nonce_val_pass if False else incoming.nonce,
                        message_counter=incoming.message_counter,
                        algorithm=incoming.algorithm,
                        sender_device_id=incoming.sender_device_id
                    )

                    # Reload with relationships
                    result = await db.execute(
                        select(Message)
                        .options(
                            joinedload(Message.sender),
                            selectinload(Message.reactions),
                            selectinload(Message.receipts),
                            joinedload(Message.reply_to).joinedload(Message.sender),
                        )
                        .where(Message.id == msg.id)
                    )
                    msg = result.scalar_one()
                    msg_out = await _build_message_out(msg)
                    participant_ids = await _get_participant_ids(db, conv_uuid)

                # Dispatch message using delivery_engine
                async with async_session() as db:
                    delivered_uids = await delivery_engine.dispatch_message(
                        db=db,
                        sender_id=UUID(user_id),
                        conversation_id=conv_uuid,
                        message_id=msg.id,
                        message_type=msg.message_type,
                        content=msg.content,
                        message_payload={
                            "event": "new_message",
                            "message": msg_out.model_dump(mode="json"),
                        },
                        recipient_ids=participant_ids
                    )

                    if delivered_uids:
                        for uid in delivered_uids:
                            await read_receipts_service.mark_as_delivered(
                                db=db,
                                message_ids=[msg.id],
                                user_id=UUID(uid)
                            )

                    # Re-read message status after delivery updates to send correct final status to sender
                    result = await db.execute(
                        select(Message)
                        .options(
                            joinedload(Message.sender),
                            selectinload(Message.reactions),
                            selectinload(Message.receipts),
                            joinedload(Message.reply_to).joinedload(Message.sender),
                        )
                        .where(Message.id == msg.id)
                    )
                    msg = result.scalar_one()
                    msg_out = await _build_message_out(msg)

                await websocket.send_json({
                    "event": "message_sent",
                    "message": msg_out.model_dump(mode="json"),
                })
            except Exception as e:
                import traceback
                traceback.print_exc()
                print(f"NEW_MESSAGE ERROR: {e}")
                try:
                    await websocket.send_json({"event": "error", "detail": str(e)})
                except Exception:
                    pass

    except WebSocketDisconnect:
        pass
    except Exception as e:
        print(f"WS LOOP ERROR: {e}")
    finally:
        # ── 4. Disconnect ─────────────────────────────────────────────────
        await manager.disconnect(user_id)
        try:
            now_utc = datetime.now(timezone.utc)
            async with async_session() as db:
                await db.execute(
                    update(User)
                    .where(User.id == UUID(user_id))
                    .values(updated_at=now_utc)
                )
                await db.commit()

                conv_ids_q = (
                    select(Participant.conversation_id)
                    .where(Participant.user_id == UUID(user_id))
                    .subquery()
                )
                result = await db.execute(
                    select(Participant.user_id).where(
                        Participant.conversation_id.in_(select(conv_ids_q.c.conversation_id))
                    )
                )
                all_related_participants = list(set(str(row[0]) for row in result.all()))

            presence_payload = {
                "event": "user_presence",
                "user_id": user_id,
                "is_online": False,
                "last_seen": now_utc.isoformat(),
            }
            await manager.broadcast_to_conversation(
                all_related_participants, presence_payload, exclude=user_id
            )
        except Exception as e:
            print(f"WS DISCONNECT BROADCAST ERROR: {e}")
