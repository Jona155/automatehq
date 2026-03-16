"""add telegram caption fields

Revision ID: i9d0e1f2g3h4
Revises: h8c9d0e1f2g3
Create Date: 2026-03-16 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'i9d0e1f2g3h4'
down_revision = 'h8c9d0e1f2g3'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('work_cards', sa.Column('telegram_caption', sa.Text(), nullable=True))
    op.add_column('telegram_ingested_files', sa.Column('telegram_caption', sa.Text(), nullable=True))
    op.add_column('telegram_ingested_files', sa.Column('media_group_id', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('telegram_ingested_files', 'media_group_id')
    op.drop_column('telegram_ingested_files', 'telegram_caption')
    op.drop_column('work_cards', 'telegram_caption')
