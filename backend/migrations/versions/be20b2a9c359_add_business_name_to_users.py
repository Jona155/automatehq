"""add_business_name_to_users

Revision ID: be20b2a9c359
Revises: 565101c9853b
Create Date: 2026-01-27 12:49:37.775835

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'be20b2a9c359'
down_revision = '565101c9853b'
branch_labels = None
depends_on = None


def upgrade():
    # No-op migration: Initial schema (b8df332d58c2) already reflects the final state
    # without business_id columns. This migration was created during development
    # when removing multi-tenancy, but is not needed for fresh databases.
    pass


def downgrade():
    # No-op migration
    pass
