"""add_contractor_phone_number_to_sites

Revision ID: l2g3h4i5j6k7
Revises: k1f2g3h4i5j6
Create Date: 2026-04-23 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'l2g3h4i5j6k7'
down_revision = 'k1f2g3h4i5j6'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('sites',
        sa.Column('contractor_phone_number', sa.Text(), nullable=True))


def downgrade():
    op.drop_column('sites', 'contractor_phone_number')
