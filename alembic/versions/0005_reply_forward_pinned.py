"""reply_forward_pinned

Revision ID: 0005_reply_forward_pinned
Revises: 0004_create_push_tokens
Create Date: 2026-06-30

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0005_reply_forward_pinned"
down_revision: Union[str, None] = "0004_create_push_tokens"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("is_pinned", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("messages", sa.Column("pinned_at", sa.DateTime(timezone=True), nullable=True))
    op.add_column("messages", sa.Column("is_forwarded", sa.Boolean(), nullable=False, server_default=sa.text("false")))
    op.add_column("messages", sa.Column("forwarded_from", sa.String(length=100), nullable=True))

    op.create_index("ix_messages_is_pinned", "messages", ["is_pinned"])
    op.create_index("ix_messages_is_forwarded", "messages", ["is_forwarded"])
    op.create_index("ix_messages_conv_pinned", "messages", ["conversation_id", "is_pinned"])


def downgrade() -> None:
    op.drop_index("ix_messages_conv_pinned", table_name="messages")
    op.drop_index("ix_messages_is_forwarded", table_name="messages")
    op.drop_index("ix_messages_is_pinned", table_name="messages")

    op.drop_column("messages", "forwarded_from")
    op.drop_column("messages", "is_forwarded")
    op.drop_column("messages", "pinned_at")
    op.drop_column("messages", "is_pinned")
