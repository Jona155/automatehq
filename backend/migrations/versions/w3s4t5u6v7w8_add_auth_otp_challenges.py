"""add auth OTP challenges

Revision ID: w3s4t5u6v7w8
Revises: u1q2r3s4t5u6
Create Date: 2026-09-09 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


revision = 'w3s4t5u6v7w8'
down_revision = 'u1q2r3s4t5u6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'auth_otp_challenges',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('user_id', postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column('code_digest', sa.String(length=64), nullable=False),
        sa.Column('request_ip_digest', sa.String(length=64), nullable=True),
        sa.Column('expires_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('consumed_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('invalidated_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('failed_attempts', sa.Integer(), nullable=False, server_default='0'),
        sa.Column('send_count', sa.Integer(), nullable=False, server_default='1'),
        sa.Column('last_sent_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
        sa.PrimaryKeyConstraint('id'),
    )
    op.create_index('ix_auth_otp_challenges_user_created', 'auth_otp_challenges', ['user_id', 'created_at'])
    op.create_index('ix_auth_otp_challenges_ip_created', 'auth_otp_challenges', ['request_ip_digest', 'created_at'])
    op.create_index('ix_auth_otp_challenges_expires_at', 'auth_otp_challenges', ['expires_at'])


def downgrade():
    op.drop_index('ix_auth_otp_challenges_expires_at', table_name='auth_otp_challenges')
    op.drop_index('ix_auth_otp_challenges_ip_created', table_name='auth_otp_challenges')
    op.drop_index('ix_auth_otp_challenges_user_created', table_name='auth_otp_challenges')
    op.drop_table('auth_otp_challenges')
