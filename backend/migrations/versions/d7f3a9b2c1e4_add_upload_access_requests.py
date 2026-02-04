"""add_upload_access_requests

Revision ID: d7f3a9b2c1e4
Revises: c1a2b3d4e5f6
Create Date: 2026-02-04 14:30:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid

# revision identifiers, used by Alembic.
revision = 'd7f3a9b2c1e4'
down_revision = 'c1a2b3d4e5f6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'upload_access_requests',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column('token', sa.String(length=64), nullable=False, unique=True),
        sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('site_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('employee_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('processing_month', sa.Date(), nullable=False),
        sa.Column('created_by_user_id', postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), server_default=sa.text('now()')),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('last_accessed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_active', sa.Boolean(), server_default=sa.text('true'), nullable=False),
        sa.ForeignKeyConstraint(['business_id'], ['businesses.id']),
        sa.ForeignKeyConstraint(['site_id'], ['sites.id']),
        sa.ForeignKeyConstraint(['employee_id'], ['employees.id']),
        sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id']),
    )

    op.create_index('ix_upload_access_requests_token', 'upload_access_requests', ['token'])
    op.create_index('ix_upload_access_requests_site', 'upload_access_requests', ['site_id'])


def downgrade():
    op.drop_index('ix_upload_access_requests_site', table_name='upload_access_requests')
    op.drop_index('ix_upload_access_requests_token', table_name='upload_access_requests')
    op.drop_table('upload_access_requests')
