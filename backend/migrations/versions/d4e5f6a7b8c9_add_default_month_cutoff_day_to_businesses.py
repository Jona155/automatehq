"""add_default_month_cutoff_day_to_businesses

Revision ID: d4e5f6a7b8c9
Revises: c2d3e4f5a6b7
Create Date: 2026-03-05 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'd4e5f6a7b8c9'
down_revision = 'c2d3e4f5a6b7'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('businesses', sa.Column('default_month_cutoff_day', sa.SmallInteger(), nullable=True))
    op.create_check_constraint(
        'ck_businesses_default_month_cutoff_day',
        'businesses',
        'default_month_cutoff_day >= 1 AND default_month_cutoff_day <= 28'
    )


def downgrade():
    op.drop_constraint('ck_businesses_default_month_cutoff_day', 'businesses', type_='check')
    op.drop_column('businesses', 'default_month_cutoff_day')
