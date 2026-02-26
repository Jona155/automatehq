"""add_extraction_mode_to_work_card_extraction

Revision ID: b1c2d3e4f5a6
Revises: a1b2c3d4e5f6
Create Date: 2026-02-26 10:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'b1c2d3e4f5a6'
down_revision = 'a1b2c3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('work_card_extraction', schema=None) as batch_op:
        batch_op.add_column(sa.Column('extraction_mode', sa.Text(), nullable=True))

    op.execute("UPDATE work_card_extraction SET extraction_mode = 'FULL' WHERE extraction_mode IS NULL")


def downgrade():
    with op.batch_alter_table('work_card_extraction', schema=None) as batch_op:
        batch_op.drop_column('extraction_mode')
