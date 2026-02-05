"""add_responsible_employee_to_sites

Revision ID: e4c2f3b7a1d9
Revises: d7f3a9b2c1e4
Create Date: 2026-02-05 12:10:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'e4c2f3b7a1d9'
down_revision = 'd7f3a9b2c1e4'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('sites', schema=None) as batch_op:
        batch_op.add_column(sa.Column('responsible_employee_id', postgresql.UUID(as_uuid=True), nullable=True))
        batch_op.create_foreign_key(
            'fk_sites_responsible_employee',
            'employees',
            ['responsible_employee_id'],
            ['id'],
            ondelete='SET NULL'
        )
        batch_op.create_index('ix_sites_responsible_employee_id', ['responsible_employee_id'], unique=False)


def downgrade():
    with op.batch_alter_table('sites', schema=None) as batch_op:
        batch_op.drop_index('ix_sites_responsible_employee_id')
        batch_op.drop_constraint('fk_sites_responsible_employee', type_='foreignkey')
        batch_op.drop_column('responsible_employee_id')
