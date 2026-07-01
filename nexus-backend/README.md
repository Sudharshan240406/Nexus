# Nexus Backend

> Real-time messaging API built with **FastAPI**, **PostgreSQL**, and **Redis**.

Nexus Backend powers instant messaging with WebSocket delivery, Redis-backed online presence, offline message queuing, and OTP-based phone authentication — all running on an async Python stack.

---

## ⚡ Tech Stack

| Layer             | Technology                                   |
| ----------------- | -------------------------------------------- |
| **Framework**     | FastAPI · Python 3.11                        |
| **Database**      | PostgreSQL 15 · SQLAlchemy 2 (async)         |
| **Cache / Queue** | Redis 7 — presence tracking & offline queue  |
| **Auth**          | JWT (PyJWT) · OTP-based phone verification   |
| **WebSockets**    | Native FastAPI WebSocket support             |
| **Containers**    | Docker · Docker Compose                      |

---

## 📁 Project Structure

```
nexus-backend/
├── main.py                         # FastAPI app, CORS, JWT middleware
├── models.py                       # SQLAlchemy ORM models
├── schemas.py                      # Pydantic request/response schemas
├── database.py                     # Async engine & session factory
├── routers/
│   ├── auth.py                     # POST /auth/request-otp, /auth/verify-otp
│   └── chat.py                     # Conversations, messages, WebSocket
├── services/
│   └── websocket_manager.py        # Redis-backed WS connection manager
├── requirements.txt                # Python dependencies
├── .env.example                    # Environment variable template
└── README.md                       # ← You are here
```

---

## 🚀 Quick Start

### Prerequisites

- Python 3.11+
- PostgreSQL 15 (running on port 5432)
- Redis 7 (running on port 6379)
- Or use the Docker setup from the project root

### 1 · Install dependencies

```bash
cd nexus-backend
pip install -r requirements.txt
```

### 2 · Configure environment

```bash
cp .env.example .env
# Edit .env with your actual database & Redis URLs
```

### 3 · Start the server

```bash
uvicorn main:app --host 0.0.0.0 --port 8000 --reload
```

### 4 · Open API docs

Navigate to **http://localhost:8000/docs** for the interactive Swagger UI.

---

## 🗄️ Database Schema

```
┌────────────────┐        ┌──────────────────┐        ┌────────────────┐
│     users      │        │   participants   │        │ conversations  │
├────────────────┤        ├──────────────────┤        ├────────────────┤
│ id       (UUID)│◄───────│ user_id     (FK) │        │ id       (UUID)│
│ phone          │        │ conversation_id  │───────►│ type           │
│ name           │        │ joined_at        │        │ title          │
│ avatar_url     │        └──────────────────┘        │ created_at     │
│ last_seen      │                                    └────────────────┘
│ created_at     │                                           ▲
└────────────────┘                                           │
       ▲                  ┌──────────────────┐               │
       ├──────────────────│     messages     │───────────────┘
       │                  ├──────────────────┤
       │                  │ id         (UUID)│
       │                  │ conversation_id  │
       │                  │ sender_id   (FK) │
       │                  │ content          │
       │                  │ media_url        │
       │                  │ type             │
       │                  │ created_at       │
       │                  └──────────────────┘
       │                           ▲
       │                           │
       │                  ┌──────────────────┐
       │                  │ message_receipts │
       │                  ├──────────────────┤
       │                  │ id         (UUID)│
       └──────────────────│ user_id     (FK) │
                          │ message_id  (FK) │
                          │ status           │
                          │ created_at       │
                          │ updated_at       │
                          └──────────────────┘
```

---

## 🔌 API Reference

### Auth (public — no JWT required)

| Method | Endpoint              | Description                              |
| ------ | --------------------- | ---------------------------------------- |
| POST   | `/auth/request-otp`   | Send OTP to phone number                 |
| POST   | `/auth/verify-otp`    | Verify OTP → returns JWT + user_id       |

### Chat (JWT required)

| Method | Endpoint                              | Description                        |
| ------ | ------------------------------------- | ---------------------------------- |
| GET    | `/conversations`                      | List all conversations for user    |
| POST   | `/conversations`                      | Create direct or group chat        |
| GET    | `/conversations/{id}/messages`        | Paginated messages (50/page)       |
| PUT    | `/profile`                            | Update display name / avatar       |
| POST   | `/upload/media`                       | Upload image or audio file. For audio, creates a message. |
| GET    | `/health`                             | Service health check               |

#### Media Upload & Audio Message (`POST /upload/media`)
- **Content-Type**: `multipart/form-data`
- **Fields**:
  - `file`: UploadFile (audio formats: `mp3`, `wav`, `m4a`, `ogg`, `webm` <= 20MB)
  - `conversation_id`: String (UUID, required for audio files)
  - `duration`: Float (seconds, optional)
  - `reply_to_message_id`: String (UUID, optional)
- **Response (Audio Message)**:
  ```json
  {
    "id": "message-uuid",
    "media_url": "/media/filename.webm",
    "duration": 12,
    "message_type": "audio"
  }
  ```

#### Message Types & Schema Metadata
- **`message_type` = `"audio"`** represents WhatsApp-style voice notes.
- **Audio Metadata fields**:
  - `duration`: integer (seconds)
  - `file_size`: integer (bytes)
  - `mime_type`: string (e.g. `audio/webm`, `audio/mpeg`, etc.)


### WebSocket

| Protocol | Endpoint                       | Description                      |
| -------- | ------------------------------ | -------------------------------- |
| WS       | `/ws/{user_id}?token=<JWT>`    | Real-time messaging channel      |

#### WebSocket Message Format (client → server)

**New Message**:
```json
{
  "conversation_id": "uuid-string",
  "content": "Hello, Nexus!",
  "type": "text"
}
```

**Mark Read**:
```json
{
  "event": "mark_read",
  "conversation_id": "uuid-string",
  "message_id": "uuid-string"
}
```

#### WebSocket Events (server → client)

**New Message Event**:
```json
{
  "event": "new_message",
  "message": {
    "id": "uuid",
    "conversation_id": "uuid",
    "sender_id": "uuid",
    "content": "Hello, Nexus!",
    "type": "text",
    "status": "sent",
    "sent_at": "2026-06-11T12:00:00Z"
  }
}
```

**Message Delivered Event**:
```json
{
  "event": "message_delivered",
  "conversation_id": "uuid",
  "message_id": "uuid",
  "user_id": "uuid"
}
```

**Message Read Event**:
```json
{
  "event": "message_read",
  "conversation_id": "uuid",
  "message_id": "uuid",
  "user_id": "uuid"
}
```

---

## 🔐 Authentication Flow

```
┌──────────┐                      ┌──────────────┐
│  Client  │──POST /request-otp──►│   Nexus API  │
│          │◄── { otp } ──────────│              │
│          │                      │              │
│          │──POST /verify-otp───►│  Verify OTP  │
│          │◄── { jwt, user_id }──│  Create user │
│          │                      │  (if new)    │
│          │                      └──────────────┘
│          │
│          │──WS /ws/{id}?token=──► Real-time channel
└──────────┘
```

---

## 📡 Redis Architecture

| Key Pattern                  | Type   | Purpose                                     |
| ---------------------------- | ------ | ------------------------------------------- |
| `nexus:online:{user_id}`     | STRING | Presence flag — "1" if user is connected    |
| `nexus:queue:{user_id}`      | LIST   | Offline message queue — JSON payloads       |

- **On connect**: Set presence key, flush queued messages
- **On message**: Deliver via WebSocket if online, push to queue if offline
- **On disconnect**: Delete presence key, update `last_seen` in PostgreSQL

---

## 🔧 Environment Variables

| Variable      | Default                                                      | Description             |
| ------------- | ------------------------------------------------------------ | ----------------------- |
| `DB_URL`      | `postgresql+asyncpg://nexus:nexus_secret@localhost:5432/nexus_db` | Async database URL |
| `REDIS_URL`   | `redis://localhost:6379/0`                                   | Redis connection string |
| `JWT_SECRET`  | `nexus-super-secret-key-change-me`                           | JWT signing key         |

---

## 📜 License

Proprietary — **Qudra Minds**. All rights reserved.
