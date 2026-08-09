"""add_completes_month_to_work_cards

Manual "this card settles the month" override used by the missing-cards report.

Revision ID: u1q2r3s4t5u6
Revises: t0p1q2r3s4t5
Create Date: 2026-08-07 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'u1q2r3s4t5u6'
down_revision = 't0p1q2r3s4t5'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'work_cards',
        sa.Column('completes_month', sa.Boolean(), nullable=False, server_default='false'),
    )


def downgrade():
    op.drop_column('work_cards', 'completes_month')
