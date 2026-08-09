"""add_report_manager_to_sites

Report-only routing for sites with no field manager: the missing-cards report
attributes their employees to this manager. Not a real assignment — field_manager_id
always wins, and no other feature reads this column.

Revision ID: v2r3s4t5u6v7
Revises: u1q2r3s4t5u6
Create Date: 2026-08-09 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'v2r3s4t5u6v7'
down_revision = 'u1q2r3s4t5u6'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('sites', schema=None) as batch_op:
        batch_op.add_column(sa.Column('report_manager_id', postgresql.UUID(as_uuid=True), nullable=True))
        batch_op.create_foreign_key(
            'fk_sites_report_manager',
            'users',
            ['report_manager_id'],
            ['id'],
            ondelete='SET NULL'
        )
        batch_op.create_index('ix_sites_report_manager_id', ['report_manager_id'], unique=False)


def downgrade():
    with op.batch_alter_table('sites', schema=None) as batch_op:
        batch_op.drop_index('ix_sites_report_manager_id')
        batch_op.drop_constraint('fk_sites_report_manager', type_='foreignkey')
        batch_op.drop_column('report_manager_id')
