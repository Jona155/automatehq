"""add_hourly_tariff_to_sites

Revision ID: h8c9d0e1f2a3
Revises: g7b8c9d0e1f2
Create Date: 2026-03-16 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'h8c9d0e1f2g3'
down_revision = 'g7b8c9d0e1f2'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('sites',
        sa.Column('hourly_tariff', sa.Numeric(10, 2), nullable=True))


def downgrade():
    op.drop_column('sites', 'hourly_tariff')
