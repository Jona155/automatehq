"""add contractors

Revision ID: x4t5u6v7w8x9
Revises: v2r3s4t5u6v7, w3s4t5u6v7w8
Create Date: 2026-09-18 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'x4t5u6v7w8x9'
down_revision = ('v2r3s4t5u6v7', 'w3s4t5u6v7w8')
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'contractors',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('name', sa.Text(), nullable=False),
        sa.Column('email', sa.Text(), nullable=True),
        sa.Column('phone_number', sa.Text(), nullable=True),
        sa.Column('address', sa.Text(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['business_id'], ['businesses.id']),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_contractors_business_id', 'contractors', ['business_id'])
    op.create_index(
        'uq_contractors_business_lower_name',
        'contractors',
        ['business_id', sa.text('lower(name)')],
        unique=True,
    )
    with op.batch_alter_table('sites') as batch_op:
        batch_op.add_column(sa.Column('contractor_id', postgresql.UUID(as_uuid=True), nullable=True))
        batch_op.create_foreign_key(
            'fk_sites_contractor_id',
            'contractors',
            ['contractor_id'],
            ['id'],
            ondelete='SET NULL',
        )
        batch_op.create_index('ix_sites_contractor_id', ['contractor_id'])


def downgrade():
    with op.batch_alter_table('sites') as batch_op:
        batch_op.drop_index('ix_sites_contractor_id')
        batch_op.drop_constraint('fk_sites_contractor_id', type_='foreignkey')
        batch_op.drop_column('contractor_id')
    op.drop_index('uq_contractors_business_lower_name', table_name='contractors')
    op.drop_index('ix_contractors_business_id', table_name='contractors')
    op.drop_table('contractors')
