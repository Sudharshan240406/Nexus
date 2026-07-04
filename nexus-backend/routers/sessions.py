"""
Nexus — E2EE Sessions Router

Endpoints
─────────
  POST   /sessions            Create or update a secure cryptographic session
  GET    /sessions/{device}   Fetch a session with a specific device (by UUID or device_id_str)
  DELETE /sessions/{id}       Deregister and delete a session
  GET    /sessions/status     List session status details for all peer sessions of this device
"""

from typing import Optional
from uuid import UUID
from datetime import datetime, timezone, timedelta

from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request, status
from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Device, DeviceSession
from schemas import (
    DeviceSessionCreate,
    DeviceSessionOut,
    DeviceSessionStatusOut,
)
from routers.chat import _get_current_user_id
from routers.keys import _get_caller_device

router = APIRouter(tags=["e2ee_sessions"])


@router.post("/sessions", response_model=DeviceSessionOut)
async def create_session(
    body: DeviceSessionCreate,
    request: Request,
    x_device_id: Optional[str] = Header(None),
    device_id_str: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """
    Establish or update a secure session with a peer device.
    If peer_session_data is supplied, it registers the handshake payload for the peer device.
    """
    user_id = _get_current_user_id(request)
    target_device_id_str = x_device_id or device_id_str
    caller_device = await _get_caller_device(db, user_id, target_device_id_str)

    # Verify peer device exists
    peer_res = await db.execute(
        select(Device).where(Device.id == body.peer_device_id)
    )
    peer_device = peer_res.scalar_one_or_none()
    if not peer_device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Peer device not found: {body.peer_device_id}"
        )

    # Replay Protection: Check if peer_session_data tries to replay an identical/old handshake
    if body.peer_session_data:
        existing_peer_session_res = await db.execute(
            select(DeviceSession).where(
                DeviceSession.device_id == peer_device.id,
                DeviceSession.peer_device_id == caller_device.id
            )
        )
        existing_peer_session = existing_peer_session_res.scalar_one_or_none()
        if existing_peer_session and existing_peer_session.session_data == body.peer_session_data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Replay attack detected: Handshake payload has already been processed"
            )

    # 1. Upsert caller's session
    session_res = await db.execute(
        select(DeviceSession).where(
            DeviceSession.device_id == caller_device.id,
            DeviceSession.peer_device_id == peer_device.id
        )
    )
    session = session_res.scalar_one_or_none()

    if session:
        session.session_data = body.session_data
        session.updated_at = datetime.now(timezone.utc)
    else:
        session = DeviceSession(
            user_id=UUID(user_id),
            device_id=caller_device.id,
            peer_user_id=body.peer_user_id,
            peer_device_id=body.peer_device_id,
            session_data=body.session_data
        )
        db.add(session)

    # 2. Upsert peer's session if handshake data is supplied (initiation phase)
    if body.peer_session_data:
        peer_session_res = await db.execute(
            select(DeviceSession).where(
                DeviceSession.device_id == peer_device.id,
                DeviceSession.peer_device_id == caller_device.id
            )
        )
        peer_session = peer_session_res.scalar_one_or_none()

        if peer_session:
            peer_session.session_data = body.peer_session_data
            peer_session.updated_at = datetime.now(timezone.utc)
        else:
            peer_session = DeviceSession(
                user_id=peer_device.user_id,
                device_id=peer_device.id,
                peer_user_id=UUID(user_id),
                peer_device_id=caller_device.id,
                session_data=body.peer_session_data
            )
            db.add(peer_session)

    await db.commit()
    await db.refresh(session)
    return session


@router.get("/sessions/status", response_model=list[DeviceSessionStatusOut])
async def get_sessions_status(
    request: Request,
    x_device_id: Optional[str] = Header(None),
    device_id_str: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """
    Get the status and metadata for all sessions registered on this device.
    """
    user_id = _get_current_user_id(request)
    target_device_id_str = x_device_id or device_id_str
    caller_device = await _get_caller_device(db, user_id, target_device_id_str)

    res = await db.execute(
        select(DeviceSession).where(DeviceSession.device_id == caller_device.id)
    )
    sessions = res.scalars().all()

    now = datetime.now(timezone.utc)
    out = []
    for s in sessions:
        # Expiration logic: sessions expire after 30 days
        is_expired = (now - s.updated_at) > timedelta(days=30)
        out.append(
            DeviceSessionStatusOut(
                id=s.id,
                peer_user_id=s.peer_user_id,
                peer_device_id=s.peer_device_id,
                is_expired=is_expired,
                created_at=s.created_at,
                updated_at=s.updated_at
            )
        )
    return out


@router.get("/sessions/{device}", response_model=DeviceSessionOut)
async def get_session(
    device: str,
    request: Request,
    x_device_id: Optional[str] = Header(None),
    device_id_str: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """
    Retrieve a session with a specific peer device.
    If the session is expired (older than 30 days), returns HTTP 410 Gone to trigger renewal.
    """
    user_id = _get_current_user_id(request)
    target_device_id_str = x_device_id or device_id_str
    caller_device = await _get_caller_device(db, user_id, target_device_id_str)

    # Resolve peer device by ID (UUID) or by display_name / device_id_str
    peer_device = None
    try:
        peer_uuid = UUID(device)
        peer_res = await db.execute(select(Device).where(Device.id == peer_uuid))
        peer_device = peer_res.scalar_one_or_none()
    except ValueError:
        pass

    if not peer_device:
        peer_res = await db.execute(
            select(Device).where(Device.device_id_str == device)
        )
        peer_device = peer_res.scalar_one_or_none()

    if not peer_device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Peer device not found: {device}"
        )

    session_res = await db.execute(
        select(DeviceSession).where(
            DeviceSession.device_id == caller_device.id,
            DeviceSession.peer_device_id == peer_device.id
        )
    )
    session = session_res.scalar_one_or_none()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found"
        )

    # Validate Expiration
    now = datetime.now(timezone.utc)
    if (now - session.updated_at) > timedelta(days=30):
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail="Session has expired. Renewal required."
        )

    return session


@router.delete("/sessions/{id}", status_code=status.HTTP_200_OK)
async def delete_session(
    id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Delete a session by its database ID.
    """
    user_id = _get_current_user_id(request)
    session_res = await db.execute(
        select(DeviceSession).where(
            DeviceSession.id == id,
            DeviceSession.user_id == UUID(user_id)
        )
    )
    session = session_res.scalar_one_or_none()
    if not session:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Session not found or not owned by user"
        )

    await db.delete(session)
    await db.commit()
    return {"message": "Session deleted successfully"}
