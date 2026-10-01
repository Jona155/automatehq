"""add per-employee absence day settings

Revision ID: z6v7w8x9y0z1
Revises: y5u6v7w8x9y0
Create Date: 2026-10-01 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'z6v7w8x9y0z1'
down_revision = 'y5u6v7w8x9y0'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'absence_employee_day_settings',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('processing_month', sa.Date(), nullable=False),
        sa.Column('employee_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('ignored_days', postgresql.JSONB(), nullable=False, server_default='[]'),
        sa.Column('updated_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['business_id'], ['businesses.id']),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['updated_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'business_id', 'processing_month', 'employee_id',
            name='uq_absence_employee_days_business_month_employee',
        ),
    )
    op.create_index(
        'ix_absence_employee_days_business_month',
        'absence_employee_day_settings',
        ['business_id', 'processing_month'],
    )


def downgrade():
    op.drop_index('ix_absence_employee_days_business_month', table_name='absence_employee_day_settings')
    op.drop_table('absence_employee_day_settings')
