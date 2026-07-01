# Nexus — By Qudra Minds

> **A real-time messaging platform built with FastAPI, PostgreSQL, and Redis.**

Nexus is a high-performance, async-first messaging backend designed for speed and scalability. It uses WebSocket-ready architecture, UUID-based entities, and a fully containerised development environment.

---

## ⚡ Tech Stack

| Layer          | Technology                            |
| -------------- | ------------------------------------- |
| **API**        | FastAPI · Python 3.11                 |
| **Database**   | PostgreSQL 15 · SQLAlchemy 2 (async)  |
| **Cache**      | Redis 7 (Alpine)                      |
| **Migrations** | Alembic (async)                       |
| **Containers** | Docker · Docker Compose               |

---

## 🚀 Quick Start

### Prerequisites

- [Docker](https://docs.docker.com/get-docker/) & Docker Compose v2+
- `make` (optional but recommended)

### 1 · Clone the repository

```bash
git clone https://github.com/neural-nexus/nexus.git
cd nexus
```

### 2 · Start all services

```bash
make up
# or without make:
docker compose up --build -d
```

This builds the API image and starts **PostgreSQL**, **Redis**, and the **FastAPI** server with hot-reload.

### 3 · Run database migrations

```bash
make migrate
# or:
docker compose exec api alembic upgrade head
```

### 4 · Seed test data

```bash
make seed
# or:
docker compose exec api python seed.py
```

This creates **3 test users** and a **sample conversation** with 5 messages:

| User           | Phone            |
| -------------- | ---------------- |
| Aarav Sharma   | +91-9999999901   |
| Priya Patel    | +91-9999999902   |
| Rohan Mehta    | +91-9999999903   |

### 5 · Verify

```bash
curl http://localhost:8000/health
# → {"status": "healthy"}
```

API docs available at **http://localhost:8000/docs** (Swagger UI).

---

## 📁 Folder Structure

```
nexus/
├── app/
│   ├── __init__.py          # Package marker
│   ├── main.py              # FastAPI application entry-point
│   ├── config.py            # Environment-based configuration
│   ├── database.py          # Async SQLAlchemy engine & session
│   └── models.py            # ORM models (User, Conversation, etc.)
├── alembic/
│   ├── env.py               # Async migration environment
│   ├── script.py.mako       # Migration template
│   └── versions/
│       └── 0001_initial_create_tables.py
├── alembic.ini              # Alembic configuration
├── docker-compose.yml       # Multi-service container setup
├── Dockerfile               # FastAPI container image
├── Makefile                 # Developer shortcuts
├── requirements.txt         # Python dependencies
├── seed.py                  # Test data seeder
└── README.md                # ← You are here
```

---

## 🗄️ Database Schema

```
┌──────────────┐       ┌──────────────────┐       ┌──────────────┐
│    users     │       │   participants   │       │ conversations│
├──────────────┤       ├──────────────────┤       ├──────────────┤
│ id (UUID)    │◄──────│ user_id (FK)     │       │ id (UUID)    │
│ phone        │       │ conversation_id  │──────►│ title        │
│ display_name │       │ role             │       │ is_group     │
│ avatar_url   │       │ joined_at        │       │ created_at   │
│ is_active    │       └──────────────────┘       │ updated_at   │
│ created_at   │                                  └──────────────┘
│ updated_at   │                                        ▲
└──────────────┘                                        │
       ▲                                                │
       │            ┌──────────────────┐                │
       ├────────────│    messages      │────────────────┘
       │            ├──────────────────┤
       │            │ id (UUID)        │
       │            │ conversation_id  │
       │            │ sender_id (FK)   │
       │            │ content          │
       │            │ message_type     │
       │            │ media_url        │
       │            │ duration         │
       │            │ file_size        │
       │            │ mime_type        │
       │            │ is_deleted       │
       │            │ created_at       │
       │            └──────────────────┘
       │                      ▲
       │                      │
       │            ┌──────────────────┐
       │            │ message_receipts │
       │            ├──────────────────┤
       │            │ id (UUID)        │
       └────────────│ user_id (FK)     │
                    │ message_id (FK)  │
                    │ status           │
                    │ created_at       │
                    │ updated_at       │
                    └──────────────────┘
```

---

## 🛠 Makefile Commands

| Command        | Description                                       |
| -------------- | ------------------------------------------------- |
| `make up`      | Build & start all containers (detached)            |
| `make down`    | Stop and remove containers                         |
| `make build`   | Rebuild the API image                              |
| `make migrate` | Run Alembic migrations inside the API container    |
| `make seed`    | Populate database with test data                   |
| `make logs`    | Stream API container logs                          |
| `make shell`   | Open a bash shell in the API container             |
| `make reset`   | Full teardown + rebuild + migrate + seed           |

---

## 🔧 Environment Variables

| Variable           | Default                                                          | Description              |
| ------------------ | ---------------------------------------------------------------- | ------------------------ |
| `DATABASE_URL`     | `postgresql+asyncpg://nexus:nexus_secret@postgres:5432/nexus_db` | Async database URL       |
| `DATABASE_URL_SYNC`| `postgresql://nexus:nexus_secret@postgres:5432/nexus_db`         | Sync URL (for seeding)   |
| `REDIS_URL`        | `redis://redis:6379/0`                                           | Redis connection string  |

---

## 📜 License

This project is proprietary to **Qudra Minds**. All rights reserved.
