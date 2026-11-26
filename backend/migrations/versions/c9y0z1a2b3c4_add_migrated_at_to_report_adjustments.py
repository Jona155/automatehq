"""add migrated_at to report_adjustments

Report edits are now written straight into work card day entries. Adjustments
saved before that change keep applying as an overlay until the one-time
``flask report-edits migrate`` command writes them into day entries and stamps
them here. Additive only: one nullable column.

Revision ID: c9y0z1a2b3c4
Revises: b8x9y0z1a2b3
Create Date: 2026-11-25 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'c9y0z1a2b3c4'
down_revision = 'b8x9y0z1a2b3'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('report_adjustments', sa.Column('migrated_at', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column('report_adjustments', 'migrated_at')
