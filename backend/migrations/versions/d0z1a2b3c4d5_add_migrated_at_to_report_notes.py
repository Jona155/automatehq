"""add migrated_at to report_notes

A note written in the report editor is now the work card's day comment (the
same field the review screen edits). Notes saved before that change keep being
appended to their report until `flask report-edits migrate` writes them into
the day comment and stamps them here. Additive only: one nullable column.

Revision ID: d0z1a2b3c4d5
Revises: c9y0z1a2b3c4
Create Date: 2026-11-26 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa


revision = 'd0z1a2b3c4d5'
down_revision = 'c9y0z1a2b3c4'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('report_notes', sa.Column('migrated_at', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    op.drop_column('report_notes', 'migrated_at')
