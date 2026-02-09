"""add_employee_status_enum

Revision ID: f3a9c1d2e4f5
Revises: e4c2f3b7a1d9
Create Date: 2026-02-09 15:10:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'f3a9c1d2e4f5'
down_revision = 'e4c2f3b7a1d9'
branch_labels = None
depends_on = None


def upgrade():
    employee_status_enum = sa.Enum(
        'ACTIVE',
        'REPORTED_IN_SPARK',
        'REPORTED_RETURNED_FROM_ESCAPE',
        name='employee_status_enum'
    )
    employee_status_enum.create(op.get_bind(), checkfirst=True)

    with op.batch_alter_table('employees', schema=None) as batch_op:
        batch_op.add_column(sa.Column('status', employee_status_enum, nullable=True))


def downgrade():
    with op.batch_alter_table('employees', schema=None) as batch_op:
        batch_op.drop_column('status')

    employee_status_enum = sa.Enum(
        'ACTIVE',
        'REPORTED_IN_SPARK',
        'REPORTED_RETURNED_FROM_ESCAPE',
        name='employee_status_enum'
    )
    employee_status_enum.drop(op.get_bind(), checkfirst=True)
