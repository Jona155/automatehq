"""add HOLIDAY to day_status check constraint

Revision ID: n4j5k6l7m8n9
Revises: m3h4i5j6k7l8
Create Date: 2026-04-27 13:00:00.000000

"""
from alembic import op


revision = 'n4j5k6l7m8n9'
down_revision = 'm3h4i5j6k7l8'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint('ck_work_card_day_entries_day_status', 'work_card_day_entries', type_='check')
    op.create_check_constraint(
        'ck_work_card_day_entries_day_status',
        'work_card_day_entries',
        "day_status IN ('VACATION', 'SICK', 'INTERNATIONAL_VISA', 'HOLIDAY')")


def downgrade():
    op.drop_constraint('ck_work_card_day_entries_day_status', 'work_card_day_entries', type_='check')
    op.create_check_constraint(
        'ck_work_card_day_entries_day_status',
        'work_card_day_entries',
        "day_status IN ('VACATION', 'SICK', 'INTERNATIONAL_VISA')")
