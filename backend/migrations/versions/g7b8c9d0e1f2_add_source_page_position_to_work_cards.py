"""add_source_page_position_to_work_cards

Revision ID: g7b8c9d0e1f2
Revises: f6a7b8c9d0e1
Create Date: 2026-03-07 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'g7b8c9d0e1f2'
down_revision = 'f6a7b8c9d0e1'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('work_cards',
        sa.Column('source_page_position', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('work_cards', 'source_page_position')
