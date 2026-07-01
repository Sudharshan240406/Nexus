"""
Nexus — E2EE Keys Router

Endpoints
─────────
  POST   /devices/register    Register or update a client device and prekey bundle
  GET    /keys/{user_id}      Fetch prekey bundles for all active devices of a user
  POST   /keys/rotate         Rotate signed prekeys or add new one-time prekeys
  GET    /devices             List all registered devices of the caller
  DELETE /devices/{id}        Remove a registered device
"""

from typing import Optional
from uuid import UUID
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, Header, Query, Request, status
from sqlalchemy import select, update, delete
from sqlalchemy.ext.asyncio import AsyncSession

from database import get_db
from models import Device, IdentityKey, SignedPrekey, OneTimePrekey, User
from schemas import (
    DeviceRegisterRequest,
    DeviceOut,
    PrekeyBundleOut,
    PrekeyBundleDeviceOut,
    KeyRotateRequest,
    SignedPrekeySchema,
    OneTimePrekeySchema,
)
from routers.chat import _get_current_user_id

router = APIRouter(tags=["e2ee_keys"])


# Helper: Get device by device_id_str for the caller
async def _get_caller_device(
    db: AsyncSession, user_id: str, device_id_str: str
) -> Device:
    result = await db.execute(
        select(Device).where(
            Device.user_id == UUID(user_id),
            Device.device_id_str == device_id_str
        )
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Device not found: {device_id_str}"
        )
    return device


@router.post("/devices/register", response_model=DeviceOut)
async def register_device(
    body: DeviceRegisterRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Register or update a client device and upload its initial prekey bundle.
    If the device already exists, it updates its public key registration.
    """
    user_id = _get_current_user_id(request)
    
    # 1. Fetch device
    result = await db.execute(
        select(Device).where(
            Device.user_id == UUID(user_id),
            Device.device_id_str == body.device_id_str
        )
    )
    device = result.scalar_one_or_none()
    
    if not device:
        device = Device(
            user_id=UUID(user_id),
            device_id_str=body.device_id_str,
            display_name=body.display_name,
            is_active=True
        )
        db.add(device)
        await db.flush()  # populate device.id
    else:
        device.display_name = body.display_name
        device.is_active = True
        device.updated_at = datetime.now(timezone.utc)
        
    # 2. Add / Update Identity Key
    ik_res = await db.execute(
        select(IdentityKey).where(IdentityKey.device_id == device.id)
    )
    ik = ik_res.scalar_one_or_none()
    if ik:
        ik.public_key = body.identity_key
    else:
        ik = IdentityKey(
            device_id=device.id,
            public_key=body.identity_key
        )
        db.add(ik)
        
    # 3. Deactivate previous signed prekeys and add new one
    await db.execute(
        update(SignedPrekey)
        .where(SignedPrekey.device_id == device.id)
        .values(is_active=False)
    )
    spk = SignedPrekey(
        device_id=device.id,
        public_key=body.signed_prekey.public_key,
        signature=body.signed_prekey.signature,
        key_id=body.signed_prekey.key_id,
        is_active=True
    )
    db.add(spk)
    
    # 4. Add One-time Prekeys
    for otkey in body.one_time_prekeys:
        opk = OneTimePrekey(
            device_id=device.id,
            public_key=otkey.public_key,
            key_id=otkey.key_id,
            is_consumed=False
        )
        db.add(opk)
        
    await db.commit()
    await db.refresh(device)
    return device


@router.get("/keys/{user_id}", response_model=PrekeyBundleOut)
async def get_user_keys(
    user_id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Fetch cryptographic prekey bundles for all active devices of user_id.
    Consumes exactly one one-time prekey per device during the query.
    """
    # Verify target user exists
    user_res = await db.execute(select(User).where(User.id == user_id))
    if not user_res.scalar_one_or_none():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="User not found"
        )
        
    # Get active devices
    dev_res = await db.execute(
        select(Device).where(Device.user_id == user_id, Device.is_active == True)
    )
    devices = dev_res.scalars().all()
    
    device_bundles = []
    
    for device in devices:
        # Fetch identity key
        ik_res = await db.execute(
            select(IdentityKey).where(IdentityKey.device_id == device.id)
        )
        ik = ik_res.scalar_one_or_none()
        if not ik:
            continue
            
        # Get active signed prekey
        spk_res = await db.execute(
            select(SignedPrekey).where(
                SignedPrekey.device_id == device.id,
                SignedPrekey.is_active == True
            )
        )
        active_spk = spk_res.scalar_one_or_none()
        if not active_spk:
            continue
            
        # Get one unconsumed one-time prekey
        opk_res = await db.execute(
            select(OneTimePrekey).where(
                OneTimePrekey.device_id == device.id,
                OneTimePrekey.is_consumed == False
            )
        )
        unconsumed_opks = opk_res.scalars().all()
        selected_opk = None
        if unconsumed_opks:
            # Sort or select first
            selected_opk = unconsumed_opks[0]
            # Mark it as consumed
            selected_opk.is_consumed = True
            db.add(selected_opk)
            
        device_bundles.append(
            PrekeyBundleDeviceOut(
                device_id=device.id,
                device_id_str=device.device_id_str,
                display_name=device.display_name,
                identity_key=ik.public_key,
                signed_prekey=SignedPrekeySchema(
                    public_key=active_spk.public_key,
                    signature=active_spk.signature,
                    key_id=active_spk.key_id
                ),
                one_time_prekey=OneTimePrekeySchema(
                    public_key=selected_opk.public_key,
                    key_id=selected_opk.key_id
                ) if selected_opk else None
            )
        )
        
    # Commit any prekey consumptions
    if device_bundles:
        await db.commit()
        
    return PrekeyBundleOut(user_id=user_id, devices=device_bundles)


@router.post("/keys/rotate", status_code=status.HTTP_200_OK)
async def rotate_keys(
    body: KeyRotateRequest,
    request: Request,
    x_device_id: Optional[str] = Header(None),
    device_id_str: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """
    Rotate signed prekey or append new one-time prekeys for the caller's device.
    """
    user_id = _get_current_user_id(request)
    
    target_device_id_str = x_device_id or device_id_str
    if not target_device_id_str:
        # Try to fallback to the first active device
        res = await db.execute(
            select(Device).where(Device.user_id == UUID(user_id), Device.is_active == True)
        )
        device = res.scalars().first()
        if not device:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="No device identifier supplied and no active device registered"
            )
    else:
        device = await _get_caller_device(db, user_id, target_device_id_str)
        
    # Rotate Signed Prekey
    if body.signed_prekey:
        await db.execute(
            update(SignedPrekey)
            .where(SignedPrekey.device_id == device.id)
            .values(is_active=False)
        )
        new_spk = SignedPrekey(
            device_id=device.id,
            public_key=body.signed_prekey.public_key,
            signature=body.signed_prekey.signature,
            key_id=body.signed_prekey.key_id,
            is_active=True
        )
        db.add(new_spk)
        
    # Append One-Time Prekeys
    if body.one_time_prekeys:
        for otkey in body.one_time_prekeys:
            opk = OneTimePrekey(
                device_id=device.id,
                public_key=otkey.public_key,
                key_id=otkey.key_id,
                is_consumed=False
            )
            db.add(opk)
            
    await db.commit()
    return {"message": "Keys rotated successfully"}


@router.get("/devices", response_model=list[DeviceOut])
async def list_devices(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    List all registered devices of the caller.
    """
    user_id = _get_current_user_id(request)
    result = await db.execute(
        select(Device).where(Device.user_id == UUID(user_id))
    )
    return result.scalars().all()


@router.delete("/devices/{id}", status_code=status.HTTP_200_OK)
async def delete_device(
    id: UUID,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    """
    Deregister and remove a device of the caller.
    """
    user_id = _get_current_user_id(request)
    result = await db.execute(
        select(Device).where(Device.id == id, Device.user_id == UUID(user_id))
    )
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device not found or not owned by caller"
        )
        
    await db.delete(device)
    await db.commit()
    return {"message": "Device deleted successfully"}
