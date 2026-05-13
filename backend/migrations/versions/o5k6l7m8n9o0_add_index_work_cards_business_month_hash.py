"""add index on work_cards (business_id, processing_month, sha256_hash)

Revision ID: o5k6l7m8n9o0
Revises: n4j5k6l7m8n9
Create Date: 2026-05-13 00:00:00.000000

"""
from alembic import op


revision = 'o5k6l7m8n9o0'
down_revision = 'n4j5k6l7m8n9'
branch_labels = None
depends_on = None


def upgrade():
    op.create_index(
        'ix_work_cards_business_month_hash',
        'work_cards',
        ['business_id', 'processing_month', 'sha256_hash'],
    )


def downgrade():
    op.drop_index('ix_work_cards_business_month_hash', table_name='work_cards')
