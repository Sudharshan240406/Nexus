# Nexus Messaging Platform Walkthrough

This document outlines the changes, implementation details, and verification results for Phase 3 – Sprint 1: **Secure Messaging & Real-Time Communication**.

---

## 1. Architecture & Core Modules

The core messaging subsystem is located in [nexus-backend/messaging](file:///C:/Users/Admin/Desktop/Nexus/nexus-backend/messaging) and is organized as follows:

- [__init__.py](file:///C:/Users/Admin/Desktop/Nexus/nexus-backend/messaging/__init__.py): Exposes all core services under a clean unified interface.
- [websocket_manager.py](file:///C:/Users/Admin/Desktop/Nexus/nexus-backend/messaging/websocket_manager.py): Tracks WebSocket connections, user presence, active conversation state, and operates a Redis-backed (with in-memory fallback) offline queue.
- [typing_manager.py](file:///C:/Users/Admin/Desktop/Nexus/nexus-backend/messaging/typing_manager.py): In-memory typing tracker with a 4.0-second sliding expiration timeout.
- [message_service.py](file:///C:/Users/Admin/Desktop/Nexus/nexus-backend/messaging/message_service.py): Manages database persistence, conversation membership verification, rate limiting, and ownership validation for edits and deletions.
- [delivery_engine.py](file:///C:/Users/Admin/Desktop/Nexus/nexus-backend/messaging/delivery_engine.py): Directs real-time dispatching. If the peer is offline, it queues the message and triggers a mobile/web push notification.
- [read_receipts.py](file:///C:/Users/Admin/Desktop/Nexus/nexus-backend/messaging/read_receipts.py): Coordinates receipt state transitions (`pending` -> `sent` -> `delivered` -> `read`) and broadcasts update events to conversation peers.
- [attachment_service.py](file:///C:/Users/Admin/Desktop/Nexus/nexus-backend/messaging/attachment_service.py): Enforces size limits (10MB for images/audio, 50MB for video/docs/PDF) and verifies file extensions against MIME types.

---

## 2. Walkthrough of Tasks & Features

### Task 2: One-to-One Messaging
- Leverages the database models for `Conversation` (where `is_group=False`) and the `Participant` associations to restrict access and query targets dynamically.

### Task 3: Real-Time WebSocket Delivery & Reconnects
- WebSocket endpoint `/ws/{user_id}?token=<JWT>` authenticates users on connect, links them to the active registry, and immediately flushes the offline queue.
- Real-time messages are dispatched instantly over active connections. Offline messages are buffered in Redis lists.

### Task 4: Presence & Typing Indicators
- Connecting or disconnecting triggers a `user_presence` broadcast to all conversation peers.
- Typing actions trigger the sending of a `typing` event, which aggregates and broadcasts currently typing users.

### Task 5: Read Receipts
- Message states transition through:
  - **Pending**: Message is being sent.
  - **Sent**: Persisted in DB, receipts initialized for peers.
  - **Delivered**: Dispatched to target client (or flushed from offline queue).
  - **Read**: Explicitly read up to a message ID.

### Task 6: Attachments
- Validates file sizes and enforces MIME type constraints before static serving at `/media`.

### Task 7: Security & Verification
- Validates conversation membership on read/write.
- Restricts edit/delete actions to the message owner.
- Implements a token bucket rate limiter allowing up to 10 messages per 10 seconds.

---

## 3. Verification & Validation Results

### Automated Tests (`pytest`)
All 26 test suites passed successfully in the backend environment:
```powershell
tests\test_e2ee_identity.py .                                            [  3%]
tests\test_e2ee_messaging.py ...                                         [ 15%]
tests\test_encrypted_media.py ...                                        [ 26%]
tests\test_message_receipts.py .....                                     [ 46%]
tests\test_messaging_platform.py ....                                    [ 61%]
tests\test_notifications.py ...                                          [ 73%]
tests\test_reply_forward_pinned.py ...                                   [ 84%]
tests\test_sessions.py ...                                               [ 96%]
tests\test_voice_notes.py .                                              [100%]
======================= 26 passed, 2 warnings in 22.22s =======================
```

### Frontend Build & Typechecking
The frontend successfully compiled and typechecked without any errors:
- **Build Command**: `npm run build` completed successfully.
- **Typecheck Command**: `npx tsc --noEmit` completed with no errors.
