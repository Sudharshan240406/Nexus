"""
Nexus — Database Seed Script

Creates 3 test users with Indian phone numbers and a sample group
conversation containing 5 messages.

Usage:
    python seed.py                  (uses DATABASE_URL_SYNC env var)
    docker compose exec api python seed.py
"""

import uuid
from datetime import datetime, timezone, timedelta

from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from app.config import DATABASE_URL_SYNC
from app.models import User, Conversation, Participant, Message
from app.database import Base


def seed() -> None:
    engine = create_engine(DATABASE_URL_SYNC, echo=True)

    # Ensure tables exist (Alembic should have run, but just in case)
    Base.metadata.create_all(engine)

    with Session(engine) as session:
        # ── Check idempotency ────────────────────────────────────────────
        existing = session.query(User).filter(User.phone == "+91-9999999901").first()
        if existing:
            print("⚠  Seed data already exists — skipping.")
            return

        # ── Users ────────────────────────────────────────────────────────
        now = datetime.now(timezone.utc)

        user_aarav = User(
            id=uuid.uuid4(),
            phone="+91-9999999901",
            display_name="Aarav Sharma",
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        user_priya = User(
            id=uuid.uuid4(),
            phone="+91-9999999902",
            display_name="Priya Patel",
            is_active=True,
            created_at=now,
            updated_at=now,
        )
        user_rohan = User(
            id=uuid.uuid4(),
            phone="+91-9999999903",
            display_name="Rohan Mehta",
            is_active=True,
            created_at=now,
            updated_at=now,
        )

        session.add_all([user_aarav, user_priya, user_rohan])
        session.flush()  # populate IDs

        # ── Conversation ─────────────────────────────────────────────────
        convo = Conversation(
            id=uuid.uuid4(),
            title="Qudra Minds Dev Team",
            is_group=True,
            created_at=now,
            updated_at=now,
        )
        session.add(convo)
        session.flush()

        # ── Participants ─────────────────────────────────────────────────
        session.add_all(
            [
                Participant(user_id=user_aarav.id, conversation_id=convo.id, role="admin", joined_at=now),
                Participant(user_id=user_priya.id, conversation_id=convo.id, role="member", joined_at=now),
                Participant(user_id=user_rohan.id, conversation_id=convo.id, role="member", joined_at=now),
            ]
        )

        # ── Messages ────────────────────────────────────────────────────
        messages_data = [
            (user_aarav, "Hey team! Welcome to the Nexus dev channel 🚀", 0),
            (user_priya, "Thanks Aarav! Excited to get started.", 1),
            (user_rohan, "Same here. I've pushed the initial DB models.", 2),
            (user_aarav, "Perfect — let's aim for a working prototype by Friday.", 3),
            (user_priya, "Sounds good. I'll start on the WebSocket layer today.", 4),
        ]

        all_users = [user_aarav, user_priya, user_rohan]
        from app.models import MessageReceipt

        for sender, content, minute_offset in messages_data:
            msg = Message(
                conversation_id=convo.id,
                sender_id=sender.id,
                content=content,
                message_type="text",
                created_at=now + timedelta(minutes=minute_offset),
            )
            session.add(msg)
            session.flush()

            # Create read receipts for other participants
            for u in all_users:
                if u.id != sender.id:
                    session.add(
                        MessageReceipt(
                            message_id=msg.id,
                            user_id=u.id,
                            status="read",
                            created_at=msg.created_at,
                            updated_at=msg.created_at,
                        )
                    )

        session.commit()
        print("✅  Seed completed successfully!")
        print(f"   → 3 users created")
        print(f"   → 1 conversation: '{convo.title}'")
        print(f"   → 5 messages seeded")


if __name__ == "__main__":
    seed()
