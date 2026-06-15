"""add_field_manager_to_sites

Revision ID: q7m8n9o0p1q2
Revises: p6l7m8n9o0p1
Create Date: 2026-06-15 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'q7m8n9o0p1q2'
down_revision = 'p6l7m8n9o0p1'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('sites', schema=None) as batch_op:
        batch_op.add_column(sa.Column('field_manager_id', postgresql.UUID(as_uuid=True), nullable=True))
        batch_op.create_foreign_key(
            'fk_sites_field_manager',
            'users',
            ['field_manager_id'],
            ['id'],
            ondelete='SET NULL'
        )
        batch_op.create_index('ix_sites_field_manager_id', ['field_manager_id'], unique=False)


def downgrade():
    with op.batch_alter_table('sites', schema=None) as batch_op:
        batch_op.drop_index('ix_sites_field_manager_id')
        batch_op.drop_constraint('fk_sites_field_manager', type_='foreignkey')
        batch_op.drop_column('field_manager_id')
