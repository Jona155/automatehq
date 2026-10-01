"""add absences month settings and employee exclusions

Revision ID: y5u6v7w8x9y0
Revises: x4t5u6v7w8x9
Create Date: 2026-09-28 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'y5u6v7w8x9y0'
down_revision = 'x4t5u6v7w8x9'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'absence_month_settings',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('processing_month', sa.Date(), nullable=False),
        sa.Column('ignored_days', postgresql.JSONB(), nullable=False, server_default='[]'),
        sa.Column('updated_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['business_id'], ['businesses.id']),
        sa.ForeignKeyConstraint(['updated_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('business_id', 'processing_month', name='uq_absence_month_settings_business_month'),
    )
    op.create_table(
        'absence_employee_exclusions',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('processing_month', sa.Date(), nullable=False),
        sa.Column('employee_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('reason', sa.Text(), nullable=True),
        sa.Column('created_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['business_id'], ['businesses.id']),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'business_id', 'processing_month', 'employee_id',
            name='uq_absence_exclusions_business_month_employee',
        ),
    )
    op.create_index(
        'ix_absence_exclusions_business_month',
        'absence_employee_exclusions',
        ['business_id', 'processing_month'],
    )


def downgrade():
    op.drop_index('ix_absence_exclusions_business_month', table_name='absence_employee_exclusions')
    op.drop_table('absence_employee_exclusions')
    op.drop_table('absence_month_settings')
