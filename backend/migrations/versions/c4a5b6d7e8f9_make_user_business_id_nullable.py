"""make_user_business_id_nullable

Revision ID: c4a5b6d7e8f9
Revises: 8866141adb90
Create Date: 2026-02-20 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'c4a5b6d7e8f9'
down_revision = '8866141adb90'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.alter_column('business_id',
               existing_type=sa.UUID(),
               nullable=True)


def downgrade():
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.alter_column('business_id',
               existing_type=sa.UUID(),
               nullable=False)
