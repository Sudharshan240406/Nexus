"""add_e2ee_message_metadata

Revision ID: 0007_add_e2ee_message_metadata
Revises: 4ed331b20150
Create Date: 2026-07-09

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = "0007_add_e2ee_message_metadata"
down_revision: Union[str, None] = "4ed331b20150"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.add_column("messages", sa.Column("encryption_version", sa.String(length=50), nullable=True))
    op.add_column("messages", sa.Column("nonce", sa.String(length=200), nullable=True))
    op.add_column("messages", sa.Column("message_counter", sa.Integer(), nullable=True))
    op.add_column("messages", sa.Column("algorithm", sa.String(length=50), nullable=True))


def downgrade() -> None:
    op.drop_column("messages", "algorithm")
    op.drop_column("messages", "message_counter")
    op.drop_column("messages", "nonce")
    op.drop_column("messages", "encryption_version")
