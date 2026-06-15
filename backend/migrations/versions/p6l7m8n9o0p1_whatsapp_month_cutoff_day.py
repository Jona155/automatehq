"""whatsapp: replace processing-month state with previous_month_cutoff_day

Adds previous_month_cutoff_day (default 10) to whatsapp_group_configs and drops
the now-unused current_processing_month + auto_advance_day columns. The cutoff
day is the single source of truth for WhatsApp month assignment.

Revision ID: p6l7m8n9o0p1
Revises: o5k6l7m8n9o0
Create Date: 2026-06-15 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


revision = 'p6l7m8n9o0p1'
down_revision = 'o5k6l7m8n9o0'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column(
        'whatsapp_group_configs',
        sa.Column('previous_month_cutoff_day', sa.SmallInteger(), nullable=False, server_default='10'),
    )
    op.drop_column('whatsapp_group_configs', 'current_processing_month')
    op.drop_column('whatsapp_group_configs', 'auto_advance_day')


def downgrade():
    op.add_column(
        'whatsapp_group_configs',
        sa.Column('auto_advance_day', sa.SmallInteger(), nullable=True),
    )
    op.add_column(
        'whatsapp_group_configs',
        sa.Column('current_processing_month', sa.Date(), nullable=True),
    )
    op.drop_column('whatsapp_group_configs', 'previous_month_cutoff_day')
