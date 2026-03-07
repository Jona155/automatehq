"""add_source_page_number_to_work_cards

Revision ID: f6a7b8c9d0e1
Revises: e5f6a7b8c9d0
Create Date: 2026-03-06 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'f6a7b8c9d0e1'
down_revision = 'e5f6a7b8c9d0'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('work_cards',
        sa.Column('source_page_number', sa.Integer(), nullable=True))


def downgrade():
    op.drop_column('work_cards', 'source_page_number')
