"""add_monthly_total_hours_to_work_cards

Revision ID: m3h4i5j6k7l8
Revises: l2g3h4i5j6k7
Create Date: 2026-04-27 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'm3h4i5j6k7l8'
down_revision = 'l2g3h4i5j6k7'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('work_cards',
        sa.Column('monthly_total_hours', sa.Numeric(7, 2), nullable=True))


def downgrade():
    op.drop_column('work_cards', 'monthly_total_hours')
