"""
Nexus — Auth Router

Endpoints
─────────
  POST /auth/request-otp   Send a one-time password to a phone number
  POST /auth/verify-otp    Verify the OTP and return a signed JWT
"""

import os
import random
import string
from datetime import datetime, timezone, timedelta
from uuid import UUID

import jwt
from dotenv import load_dotenv
from fastapi import APIRouter, HTTPException, status, Request, Depends
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
import bcrypt

from database import async_session, get_db
from models import User
from schemas import OTPRequest, OTPVerify, TokenResponse, SetPINRequest, VerifyPINRequest, UserOut

load_dotenv()

JWT_SECRET: str = os.getenv("JWT_SECRET", "nexus-super-secret-key-change-me")
JWT_ALGORITHM: str = "HS256"
JWT_EXPIRE_HOURS: int = 72

router = APIRouter(prefix="/auth", tags=["auth"])

# ── In-memory OTP store (swap with Redis / SMS provider in production) ───────
_otp_store: dict[str, str] = {}


def _generate_otp(length: int = 6) -> str:
    return "".join(random.choices(string.digits, k=length))


def create_access_token(user_id: str) -> str:
    """Sign a JWT containing the user_id claim."""
    payload = {
        "sub": user_id,
        "iat": datetime.now(timezone.utc),
        "exp": datetime.now(timezone.utc) + timedelta(hours=JWT_EXPIRE_HOURS),
    }
    return jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Verify & decode a JWT.  Raises HTTPException on failure."""
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token has expired",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token",
        )


# ── Endpoints ────────────────────────────────────────────────────────────────

@router.post("/request-otp", status_code=status.HTTP_200_OK)
async def request_otp(body: OTPRequest):
    """
    Generate and "send" an OTP for the given phone number.
    In development the OTP is returned in the response for convenience.
    """
    otp = _generate_otp()
    _otp_store[body.phone] = otp

    # TODO: integrate real SMS gateway (Twilio / MSG91)
    return {
        "message": "OTP sent successfully",
        "phone": body.phone,
        "otp_dev_only": otp,  # ⚠ Remove in production
    }


@router.post("/verify-otp", response_model=TokenResponse)
async def verify_otp(body: OTPVerify):
    """
    Verify the OTP.  On success:
      • Create the user if they don't exist (auto-registration)
      • Return a signed JWT
    """
    stored_otp = _otp_store.get(body.phone)
    if not stored_otp or stored_otp != body.otp:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired OTP",
        )

    # OTP is single-use
    del _otp_store[body.phone]

    async with async_session() as session:
        # Find or create user
        result = await session.execute(
            select(User).where(User.phone == body.phone)
        )
        user = result.scalar_one_or_none()

        if user is None:
            user = User(phone=body.phone, display_name="Nexus User")
            session.add(user)
            await session.commit()
            await session.refresh(user)

        token = create_access_token(str(user.id))

        return TokenResponse(
            access_token=token,
            user_id=str(user.id),
        )


def _get_current_user_id(request: Request) -> str:
    user_id = getattr(request.state, "user_id", None)
    if not user_id:
        raise HTTPException(status_code=401, detail="Not authenticated")
    return user_id


@router.get("/me", response_model=UserOut)
async def get_current_user(
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    user_id = _get_current_user_id(request)
    result = await db.execute(select(User).where(User.id == UUID(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    return user


@router.post("/set-pin", status_code=status.HTTP_200_OK)
async def set_pin(
    body: SetPINRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    user_id = _get_current_user_id(request)
    result = await db.execute(select(User).where(User.id == UUID(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    # Hash PIN with bcrypt
    hashed = bcrypt.hashpw(body.pin.encode("utf-8"), bcrypt.gensalt()).decode("utf-8")
    user.pin_hash = hashed
    await db.commit()
    return {"message": "PIN configured successfully"}


@router.post("/verify-pin", status_code=status.HTTP_200_OK)
async def verify_pin(
    body: VerifyPINRequest,
    request: Request,
    db: AsyncSession = Depends(get_db)
):
    user_id = _get_current_user_id(request)
    result = await db.execute(select(User).where(User.id == UUID(user_id)))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")

    if not user.pin_hash:
        raise HTTPException(status_code=400, detail="No PIN configured")

    try:
        valid = bcrypt.checkpw(body.pin.encode("utf-8"), user.pin_hash.encode("utf-8"))
    except Exception:
        valid = False

    if not valid:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid PIN")

    return {"message": "PIN verified successfully"}
