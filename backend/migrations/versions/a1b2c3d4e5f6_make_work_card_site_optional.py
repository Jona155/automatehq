"""make_work_card_site_optional

Revision ID: a1b2c3d4e5f6
Revises: c4a5b6d7e8f9
Create Date: 2026-02-25 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a1b2c3d4e5f6'
down_revision = 'c4a5b6d7e8f9'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('work_cards', schema=None) as batch_op:
        batch_op.alter_column('site_id',
               existing_type=sa.UUID(),
               nullable=True)


def downgrade():
    with op.batch_alter_table('work_cards', schema=None) as batch_op:
        batch_op.alter_column('site_id',
               existing_type=sa.UUID(),
               nullable=False)
