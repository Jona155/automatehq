"""add_day_status_to_work_card_day_entries

Revision ID: e5f6a7b8c9d0
Revises: d4e5f6a7b8c9
Create Date: 2026-03-05 11:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'e5f6a7b8c9d0'
down_revision = 'd4e5f6a7b8c9'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('work_card_day_entries',
        sa.Column('day_status', sa.Text(), nullable=True))
    op.create_check_constraint(
        'ck_work_card_day_entries_day_status',
        'work_card_day_entries',
        "day_status IN ('VACATION', 'SICK', 'INTERNATIONAL_VISA')")


def downgrade():
    op.drop_constraint('ck_work_card_day_entries_day_status', 'work_card_day_entries', type_='check')
    op.drop_column('work_card_day_entries', 'day_status')
