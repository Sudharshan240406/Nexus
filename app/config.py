"""
Nexus — Configuration via environment variables
"""

import os

DATABASE_URL: str = os.getenv(
    "DATABASE_URL",
    "postgresql+asyncpg://nexus:nexus_secret@localhost:5432/nexus_db",
)

DATABASE_URL_SYNC: str = os.getenv(
    "DATABASE_URL_SYNC",
    "postgresql://nexus:nexus_secret@localhost:5432/nexus_db",
)

REDIS_URL: str = os.getenv("REDIS_URL", "redis://localhost:6379/0")
