"""
Nexus Backend — Application Entry-Point

• CORS enabled for all origins
• JWT auth middleware that skips /auth/* and /docs paths
• WebSocket + REST routers mounted
• Redis connection manager lifecycle hooks
"""

import os
import json
import asyncio
import httpx
import uuid
from uuid import UUID
from contextlib import asynccontextmanager

from dotenv import load_dotenv
from fastapi import FastAPI, Request, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles

from database import engine, Base, async_session
from routers import auth, chat
from services.websocket_manager import manager
from pywebpush import webpush, WebPushException

load_dotenv()

JWT_SECRET: str = os.getenv("JWT_SECRET", "nexus-super-secret-key-change-me")

# ═══════════════════════════════════════════════════════════════════════════════
#  VAPID Configuration
# ═══════════════════════════════════════════════════════════════════════════════
VAPID_PRIVATE_KEY = os.getenv("VAPID_PRIVATE_KEY")
VAPID_PUBLIC_KEY = os.getenv("VAPID_PUBLIC_KEY")
VAPID_CLAIMS = {"sub": "mailto:admin@nexus.chat"}

if not VAPID_PRIVATE_KEY or not VAPID_PUBLIC_KEY:
    VAPID_PRIVATE_KEY = """-----BEGIN PRIVATE KEY-----
MIGHAgEAMBMGByqGSM49AgEGCCqGSM49AwEHBG0wawIBAQQg3Q2nuoFKVqg0o2fk
CFcRKzTt+snCfXbJi7IvoxwljjahRANCAAQ1vjyD+itFL0KLQ/B7ODjKLCNpykdF
x8icTlhS0Y/3SlOAXZCD/BIBzakKb0VRG2thqBsSfeuDacX8th2NXWTc
-----END PRIVATE KEY-----"""
    VAPID_PUBLIC_KEY = "BDW-PIP6K0UvQotD8Hs4OMosI2nKR0XHyJxOWFLRj_dKU4BdkIP8EgHNqQpvRVEba2GoGxJ964Npxfy2HY1dZNw"


# ═══════════════════════════════════════════════════════════════════════════════
#  Push Notification Worker Helpers
# ═══════════════════════════════════════════════════════════════════════════════

async def delete_token_from_db(token_str: str):
    """Delete invalid/expired push tokens from DB."""
    try:
        async with async_session() as db:
            from models import PushToken
            from sqlalchemy import delete
            stmt = delete(PushToken).where(PushToken.token == token_str)
            await db.execute(stmt)
            await db.commit()
            print(f"Deleted invalid/expired token from DB: {token_str}")
    except Exception as e:
        print(f"Failed to delete token from DB: {e}")


async def deliver_web_push(token_str: str, title: str, body: str, conversation_id: str, message_id: str, notif_type: str) -> bool:
    """Deliver a push notification to Web client."""
    try:
        sub_info = json.loads(token_str)
    except Exception:
        await delete_token_from_db(token_str)
        return False

    payload = {
        "title": title,
        "body": body,
        "conversation_id": conversation_id,
        "message_id": message_id,
        "type": notif_type
    }

    try:
        def _send():
            return webpush(
                subscription_info=sub_info,
                data=json.dumps(payload),
                vapid_private_key=VAPID_PRIVATE_KEY,
                vapid_claims=VAPID_CLAIMS,
                ttl=86400
            )
        
        loop = asyncio.get_running_loop()
        resp = await loop.run_in_executor(None, _send)
        return resp.status_code in (200, 201, 202)
    except WebPushException as ex:
        print(f"WebPush delivery exception: {ex}")
        if ex.response is not None and ex.response.status_code in (404, 410):
            await delete_token_from_db(token_str)
        return False
    except Exception as ex:
        print(f"WebPush delivery general error: {ex}")
        return False


async def deliver_expo_push(token_str: str, title: str, body: str, conversation_id: str, message_id: str, notif_type: str) -> bool:
    """Deliver a push notification to Mobile client (Android/iOS) via Expo API."""
    payload = {
        "to": token_str,
        "title": title,
        "body": body,
        "data": {
            "conversation_id": conversation_id,
            "message_id": message_id,
            "type": notif_type
        }
    }
    
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.post(
                "https://exp.host/--/api/v2/push/send",
                json=payload,
                headers={"Content-Type": "application/json"},
                timeout=5.0
            )
            if resp.status_code == 200:
                res_data = resp.json()
                data_list = res_data.get("data")
                if isinstance(data_list, dict):
                    data_list = [data_list]
                
                for item in data_list:
                    if item.get("status") == "error":
                        error_code = item.get("details", {}).get("error")
                        print(f"Expo push error details: {item}")
                        if error_code in ("DeviceNotRegistered", "InvalidCredentials"):
                            await delete_token_from_db(token_str)
                        return False
                return True
            else:
                print(f"Expo push API returned status code {resp.status_code}: {resp.text}")
                return False
    except Exception as ex:
        print(f"Expo push delivery error: {ex}")
        return False


async def process_notification_job(job: dict):
    """Resolve tokens and deliver notification to target user's active devices."""
    user_id = job.get("user_id")
    title = job.get("title")
    body = job.get("body")
    conversation_id = job.get("conversation_id")
    message_id = job.get("message_id")
    notif_type = job.get("type", "message")
    retries = job.get("retries", 0)

    async with async_session() as db:
        from models import PushToken
        from sqlalchemy import select
        stmt = select(PushToken).where(PushToken.user_id == UUID(user_id))
        res = await db.execute(stmt)
        tokens = res.scalars().all()

    if not tokens:
        return

    for t in tokens:
        success = False
        try:
            if t.platform == "web":
                success = await deliver_web_push(t.token, title, body, conversation_id, message_id, notif_type)
            elif t.platform in ("android", "ios"):
                success = await deliver_expo_push(t.token, title, body, conversation_id, message_id, notif_type)
        except Exception as e:
            print(f"Delivery failed for token {t.token} on {t.platform}: {e}")

        if not success:
            if retries < 3:
                retry_job = {**job, "retries": retries + 1}
                async def requeue_after_delay(delayed_job, delay):
                    await asyncio.sleep(delay)
                    if manager._redis:
                        await manager._redis.rpush("nexus:notifications", json.dumps(delayed_job))
                
                backoff_delay = 2 ** (retries + 1)
                asyncio.create_task(requeue_after_delay(retry_job, backoff_delay))


async def notification_worker():
    """Background task loop that processes push notifications from Redis."""
    print("Notification worker started")
    while True:
        try:
            if not manager._redis:
                await asyncio.sleep(1)
                continue

            res = await manager._redis.blpop("nexus:notifications", timeout=5)
            if not res:
                continue

            _, raw_job = res
            job = json.loads(raw_job)
            await process_notification_job(job)
        except asyncio.CancelledError:
            print("Notification worker stopped (cancelled)")
            break
        except Exception as e:
            print(f"Error in notification worker loop: {e}")
            await asyncio.sleep(1)


_notification_worker_task = None


@asynccontextmanager
async def lifespan(application: FastAPI):
    # Startup
    async with engine.begin() as conn:
        from sqlalchemy import text
        await conn.run_sync(Base.metadata.create_all)
        # Execute migration queries for new columns only on PostgreSQL dialect
        if engine.dialect.name == "postgresql":
            await conn.execute(
                text("ALTER TABLE participants ADD COLUMN IF NOT EXISTS last_read_message_id UUID REFERENCES messages(id) ON DELETE SET NULL")
            )
            await conn.execute(
                text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS reply_to_message_id UUID REFERENCES messages(id) ON DELETE SET NULL")
            )
            await conn.execute(
                text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS is_edited BOOLEAN NOT NULL DEFAULT FALSE")
            )
            await conn.execute(
                text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS edited_at TIMESTAMP WITH TIME ZONE")
            )
            await conn.execute(
                text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS duration INTEGER")
            )
            await conn.execute(
                text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS file_size INTEGER")
            )
            await conn.execute(
                text("ALTER TABLE messages ADD COLUMN IF NOT EXISTS mime_type VARCHAR(100)")
            )
            await conn.execute(
                text("ALTER TABLE messages ALTER COLUMN content DROP NOT NULL")
            )
            await conn.execute(
                text("""
                CREATE TABLE IF NOT EXISTS push_tokens (
                    id UUID PRIMARY KEY,
                    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                    token VARCHAR(500) UNIQUE NOT NULL,
                    platform VARCHAR(20) NOT NULL,
                    created_at TIMESTAMP WITH TIME ZONE NOT NULL,
                    updated_at TIMESTAMP WITH TIME ZONE NOT NULL
                )
                """)
            )
            await conn.execute(
                text("CREATE INDEX IF NOT EXISTS idx_push_tokens_user_id ON push_tokens(user_id)")
            )
            await conn.execute(
                text("CREATE INDEX IF NOT EXISTS idx_push_tokens_token ON push_tokens(token)")
            )
    await manager.initialize()

    # Start background worker task
    global _notification_worker_task
    _notification_worker_task = asyncio.create_task(notification_worker())

    yield

    # Shutdown
    if _notification_worker_task:
        _notification_worker_task.cancel()
        try:
            await _notification_worker_task
        except asyncio.CancelledError:
            pass

    await manager.shutdown()
    await engine.dispose()


# ═══════════════════════════════════════════════════════════════════════════════
#  APP
# ═══════════════════════════════════════════════════════════════════════════════

app = FastAPI(
    title="Nexus Backend",
    description="Real-time messaging API — powered by FastAPI, PostgreSQL & Redis",
    version="1.0.0",
    lifespan=lifespan,
)


# ── CORS ─────────────────────────────────────────────────────────────────────

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "http://localhost:8000",
        "http://127.0.0.1:8000",
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── JWT Auth Middleware ──────────────────────────────────────────────────────

# Paths that do NOT require authentication
_PUBLIC_PREFIXES = (
    "/auth/request-otp",
    "/auth/verify-otp",
    "/docs",
    "/redoc",
    "/openapi.json",
    "/health",
    "/media",  # Uploaded images served statically — public read, auth handled at upload time
)


@app.middleware("http")
async def jwt_auth_middleware(request: Request, call_next):
    """
    Intercept every HTTP request and verify the JWT bearer token.
    WebSocket upgrades and public paths are excluded.
    """
    path = request.url.path

    # Let CORS preflight requests through without auth
    if request.method == "OPTIONS":
        return await call_next(request)

    # Skip auth for public routes
    if any(path.startswith(prefix) for prefix in _PUBLIC_PREFIXES):
        return await call_next(request)

    # Skip WebSocket upgrade requests (they authenticate inside the handler)
    if request.headers.get("upgrade", "").lower() == "websocket":
        return await call_next(request)

    # Extract token from Authorization header
    auth_header = request.headers.get("Authorization", "")
    if not auth_header.startswith("Bearer "):
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Missing or invalid Authorization header"},
        )

    token = auth_header.removeprefix("Bearer ").strip()

    try:
        from routers.auth import decode_access_token
        payload = decode_access_token(token)
        request.state.user_id = payload["sub"]
    except Exception:
        return JSONResponse(
            status_code=status.HTTP_401_UNAUTHORIZED,
            content={"detail": "Invalid or expired token"},
        )

    return await call_next(request)


# ── Health Check ─────────────────────────────────────────────────────────────

@app.get("/health", tags=["health"])
async def health():
    return {"status": "healthy", "service": "nexus-backend"}


# ── Mount Routers ────────────────────────────────────────────────────────────
# IMPORTANT: Include API routers FIRST so POST /media/upload is handled by FastAPI
# before the StaticFiles mount at /media intercepts requests.

app.include_router(auth.router)
app.include_router(chat.router)

# Mount static file serving AFTER routers so /media/upload is not intercepted
os.makedirs("uploads", exist_ok=True)
app.mount("/media", StaticFiles(directory="uploads"), name="media")
