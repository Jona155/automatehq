"""add_comment_to_day_entries

Revision ID: t0p1q2r3s4t5
Revises: s9o0p1q2r3s4
Create Date: 2026-07-21 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 't0p1q2r3s4t5'
down_revision = 's9o0p1q2r3s4'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('work_card_day_entries',
        sa.Column('comment', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('work_card_day_entries', 'comment')
