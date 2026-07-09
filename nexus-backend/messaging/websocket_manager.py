"""
Nexus — WebSocket Connection Manager with Redis/In-memory Backing
"""

import json
import os
import asyncio
from datetime import datetime, timezone
from collections import defaultdict
from fastapi import WebSocket
import redis.asyncio as aioredis
from dotenv import load_dotenv

load_dotenv()

REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")

# Redis key prefixes
_ONLINE_KEY = "nexus:online:{user_id}"          # SET — value = "1"
_QUEUE_KEY = "nexus:queue:{user_id}"             # LIST — JSON-encoded messages


class ConnectionManager:
    """
    Manages WebSocket connections and Redis-backed presence + offline queues.
    """

    def __init__(self) -> None:
        # In-memory map: user_id (str) → WebSocket
        self._connections: dict[str, WebSocket] = {}
        # In-memory map: user_id (str) → conversation_id (str)
        self._active_chats: dict[str, str] = {}
        self._redis: aioredis.Redis | None = None
        self._use_redis = False
        self._in_memory_presence: set[str] = set()
        self._in_memory_queue: dict[str, list[str]] = defaultdict(list)

    # ── Lifecycle ────────────────────────────────────────────────────────

    async def initialize(self) -> None:
        """Create the Redis connection pool. Call once during app startup."""
        self._redis = aioredis.from_url(
            REDIS_URL,
            decode_responses=True,
            max_connections=50,
        )
        try:
            # Test connection with a short timeout
            await asyncio.wait_for(self._redis.ping(), timeout=2.0)
            self._use_redis = True
            print("[Nexus WS] Connected to Redis successfully.")
        except Exception as e:
            self._redis = None
            self._use_redis = False
            print(f"[Nexus WS] Redis not available: {e}. Falling back to in-memory presence and queueing.")

    async def shutdown(self) -> None:
        """Gracefully close the Redis pool. Call once during app shutdown."""
        if self._use_redis and self._redis:
            await self._redis.aclose()

    # ── Connect / Disconnect ─────────────────────────────────────────────

    async def connect(self, user_id: str, websocket: WebSocket, on_delivered_callback=None) -> None:
        """Accept the WS handshake, register the connection & mark online."""
        await websocket.accept()
        self._connections[user_id] = websocket

        # Mark online
        if self._use_redis and self._redis:
            try:
                await self._redis.set(_ONLINE_KEY.format(user_id=user_id), "1")
            except Exception:
                pass
        else:
            self._in_memory_presence.add(user_id)

        # Flush any messages that were queued while the user was offline
        await self._flush_offline_queue(user_id, websocket, on_delivered_callback)

    async def disconnect(self, user_id: str) -> None:
        """Remove the local connection and mark the user offline."""
        self._connections.pop(user_id, None)
        self._active_chats.pop(user_id, None)

        # Remove online flag
        if self._use_redis and self._redis:
            try:
                await self._redis.delete(_ONLINE_KEY.format(user_id=user_id))
            except Exception:
                pass
        else:
            self._in_memory_presence.discard(user_id)

    # ── Active Chats ──────────────────────────────────────────────────────

    def enter_conversation(self, user_id: str, conversation_id: str) -> None:
        """Track that the user is currently viewing a specific conversation."""
        self._active_chats[user_id] = str(conversation_id)

    def leave_conversation(self, user_id: str) -> None:
        """Track that the user has navigated away from their active conversation."""
        self._active_chats.pop(user_id, None)

    def is_user_viewing_chat(self, user_id: str, conversation_id: str) -> bool:
        """Check if the user is actively viewing the specified conversation."""
        return self._active_chats.get(user_id) == str(conversation_id)

    # ── Presence ─────────────────────────────────────────────────────────

    async def is_online(self, user_id: str) -> bool:
        """Check if a user has an active WebSocket anywhere."""
        if self._use_redis and self._redis:
            try:
                return bool(await self._redis.exists(_ONLINE_KEY.format(user_id=user_id)))
            except Exception:
                pass
        return user_id in self._connections or user_id in self._in_memory_presence

    async def get_online_users(self, user_ids: list[str]) -> list[str]:
        """Return the subset of *user_ids* that are currently online."""
        if not user_ids:
            return []
        if self._use_redis and self._redis:
            try:
                pipe = self._redis.pipeline()
                for uid in user_ids:
                    pipe.exists(_ONLINE_KEY.format(user_id=uid))
                results = await pipe.execute()
                return [uid for uid, exists in zip(user_ids, results) if exists]
            except Exception:
                pass
        return [uid for uid in user_ids if uid in self._connections or uid in self._in_memory_presence]

    # ── Messaging ────────────────────────────────────────────────────────

    async def send_to_user(self, user_id: str, payload: dict) -> bool:
        """
        Deliver *payload* to *user_id*.
        """
        ws = self._connections.get(user_id)
        if ws:
            try:
                await ws.send_json(payload)
                return True
            except Exception:
                await self.disconnect(user_id)

        # Queue the message for offline delivery
        await self._enqueue(user_id, payload)
        return False

    async def broadcast_to_conversation(
        self,
        participant_ids: list[str],
        payload: dict,
        *,
        exclude: str | None = None,
    ) -> list[str]:
        """Send *payload* to every participant except *exclude*. Returns list of delivered user_ids."""
        delivered = []
        for uid in participant_ids:
            if uid != exclude:
                if await self.send_to_user(uid, payload):
                    delivered.append(uid)
        return delivered

    # ── Offline Queue ──────────────────────────────────────────────────

    async def _enqueue(self, user_id: str, payload: dict) -> None:
        """Push a JSON message onto the user's offline queue."""
        raw = json.dumps(payload, default=str)
        if self._use_redis and self._redis:
            try:
                await self._redis.rpush(_QUEUE_KEY.format(user_id=user_id), raw)
                return
            except Exception:
                pass
        self._in_memory_queue[user_id].append(raw)

    async def _flush_offline_queue(
        self, user_id: str, websocket: WebSocket, on_delivered_callback=None
    ) -> None:
        """Pop all queued messages and deliver them over the WebSocket."""
        key = _QUEUE_KEY.format(user_id=user_id)
        delivered_payloads = []
        while True:
            raw = None
            if self._use_redis and self._redis:
                try:
                    raw = await self._redis.lpop(key)
                except Exception:
                    pass
            else:
                if self._in_memory_queue[user_id]:
                    raw = self._in_memory_queue[user_id].pop(0)

            if raw is None:
                break
            try:
                payload = json.loads(raw)
                await websocket.send_json(payload)
                delivered_payloads.append(payload)
            except Exception:
                if self._use_redis and self._redis:
                    try:
                        await self._redis.lpush(key, raw)
                    except Exception:
                        pass
                else:
                    self._in_memory_queue[user_id].insert(0, raw)
                break

        if delivered_payloads and on_delivered_callback:
            try:
                await on_delivered_callback(user_id, delivered_payloads)
            except Exception as e:
                print(f"Error in on_delivered_callback: {e}")


manager = ConnectionManager()
