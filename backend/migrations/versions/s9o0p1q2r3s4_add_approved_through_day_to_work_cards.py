"""add_approved_through_day_to_work_cards

Revision ID: s9o0p1q2r3s4
Revises: c4d5e6f7a8b9
Create Date: 2026-07-05 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 's9o0p1q2r3s4'
down_revision = 'c4d5e6f7a8b9'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('work_cards',
        sa.Column('approved_through_day', sa.SmallInteger(), nullable=True))


def downgrade():
    op.drop_column('work_cards', 'approved_through_day')
