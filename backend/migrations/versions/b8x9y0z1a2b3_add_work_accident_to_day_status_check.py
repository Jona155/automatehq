"""add WORK_ACCIDENT to day_status check constraint

Revision ID: b8x9y0z1a2b3
Revises: a7w8x9y0z1a2
Create Date: 2026-11-23 00:00:00.000000

"""
from alembic import op


revision = 'b8x9y0z1a2b3'
down_revision = 'a7w8x9y0z1a2'
branch_labels = None
depends_on = None


def upgrade():
    op.drop_constraint('ck_work_card_day_entries_day_status', 'work_card_day_entries', type_='check')
    op.create_check_constraint(
        'ck_work_card_day_entries_day_status',
        'work_card_day_entries',
        "day_status IN ('VACATION', 'SICK', 'INTERNATIONAL_VISA', 'HOLIDAY', 'WORK_ACCIDENT')")


def downgrade():
    # Fails if any row still holds WORK_ACCIDENT; clear those first.
    op.drop_constraint('ck_work_card_day_entries_day_status', 'work_card_day_entries', type_='check')
    op.create_check_constraint(
        'ck_work_card_day_entries_day_status',
        'work_card_day_entries',
        "day_status IN ('VACATION', 'SICK', 'INTERNATIONAL_VISA', 'HOLIDAY')")
