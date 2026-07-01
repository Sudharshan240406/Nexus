"""add_audio_metadata

Revision ID: 0003_add_audio_metadata
Revises: 0002_create_message_receipts
Create Date: 2026-06-24

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0003_add_audio_metadata"
down_revision: Union[str, None] = "0002_create_message_receipts"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("duration", sa.Integer(), nullable=True))
    op.add_column("messages", sa.Column("file_size", sa.Integer(), nullable=True))
    op.add_column("messages", sa.Column("mime_type", sa.String(length=100), nullable=True))


def downgrade() -> None:
    op.drop_column("messages", "mime_type")
    op.drop_column("messages", "file_size")
    op.drop_column("messages", "duration")
