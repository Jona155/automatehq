"""add report adjustments, notes and revisions

Additive only: three new tables, no change to existing tables.

Revision ID: a7w8x9y0z1a2
Revises: z6v7w8x9y0z1
Create Date: 2026-11-20 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'a7w8x9y0z1a2'
down_revision = 'z6v7w8x9y0z1'
branch_labels = None
depends_on = None


def _common_columns():
    return [
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('site_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('processing_month', sa.Date(), nullable=False),
    ]


def upgrade():
    op.create_table(
        'report_adjustments',
        *_common_columns(),
        sa.Column('employee_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('day_of_month', sa.SmallInteger(), nullable=False),
        sa.Column('hours', sa.Numeric(5, 2), nullable=True),
        sa.Column('day_status', sa.Text(), nullable=True),
        sa.Column('base_value', postgresql.JSONB(), nullable=False, server_default='{}'),
        sa.Column('updated_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['business_id'], ['businesses.id']),
        sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['updated_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'site_id', 'processing_month', 'employee_id', 'day_of_month',
            name='uq_report_adjustments_site_month_employee_day',
        ),
        sa.CheckConstraint('day_of_month >= 1 AND day_of_month <= 31', name='check_report_adjustments_day'),
    )
    op.create_index(
        'ix_report_adjustments_business_month', 'report_adjustments', ['business_id', 'processing_month']
    )

    op.create_table(
        'report_notes',
        *_common_columns(),
        sa.Column('report_type', sa.Text(), nullable=False),
        sa.Column('employee_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('day_of_month', sa.SmallInteger(), nullable=False),
        sa.Column('text', sa.Text(), nullable=False),
        sa.Column('updated_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['business_id'], ['businesses.id']),
        sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['updated_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint(
            'site_id', 'processing_month', 'report_type', 'employee_id', 'day_of_month',
            name='uq_report_notes_site_month_type_employee_day',
        ),
        sa.CheckConstraint('day_of_month >= 1 AND day_of_month <= 31', name='check_report_notes_day'),
    )
    op.create_index('ix_report_notes_business_month', 'report_notes', ['business_id', 'processing_month'])

    op.create_table(
        'report_revisions',
        *_common_columns(),
        sa.Column('revision', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('updated_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.ForeignKeyConstraint(['business_id'], ['businesses.id']),
        sa.ForeignKeyConstraint(['site_id'], ['sites.id'], ondelete='CASCADE'),
        sa.ForeignKeyConstraint(['updated_by_user_id'], ['users.id'], ondelete='SET NULL'),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('site_id', 'processing_month', name='uq_report_revisions_site_month'),
    )


def downgrade():
    op.drop_table('report_revisions')
    op.drop_index('ix_report_notes_business_month', table_name='report_notes')
    op.drop_table('report_notes')
    op.drop_index('ix_report_adjustments_business_month', table_name='report_adjustments')
    op.drop_table('report_adjustments')
