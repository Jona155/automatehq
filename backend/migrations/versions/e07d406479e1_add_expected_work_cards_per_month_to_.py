"""add expected_work_cards_per_month to businesses and sites

Revision ID: e07d406479e1
Revises: r8n9o0p1q2r3
Create Date: 2026-06-17 20:43:13.503039

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'e07d406479e1'
down_revision = 'r8n9o0p1q2r3'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('businesses', schema=None) as batch_op:
        batch_op.add_column(sa.Column('expected_work_cards_per_month', sa.SmallInteger(), server_default='2', nullable=False))

    with op.batch_alter_table('sites', schema=None) as batch_op:
        batch_op.add_column(sa.Column('expected_work_cards_per_month', sa.SmallInteger(), nullable=True))


def downgrade():
    with op.batch_alter_table('sites', schema=None) as batch_op:
        batch_op.drop_column('expected_work_cards_per_month')

    with op.batch_alter_table('businesses', schema=None) as batch_op:
        batch_op.drop_column('expected_work_cards_per_month')
