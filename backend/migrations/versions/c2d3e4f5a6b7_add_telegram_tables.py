"""add_telegram_tables

Revision ID: c2d3e4f5a6b7
Revises: b1c2d3e4f5a6
Create Date: 2026-02-26 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'c2d3e4f5a6b7'
down_revision = 'b1c2d3e4f5a6'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'telegram_bot_configs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('business_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('businesses.id'), nullable=False, unique=True),
        sa.Column('telegram_chat_id', sa.BigInteger(), nullable=False),
        sa.Column('current_processing_month', sa.Date(), nullable=False),
        sa.Column('auto_advance_day', sa.SmallInteger(), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_telegram_bot_config_chat_id', 'telegram_bot_configs', ['telegram_chat_id'])

    op.create_table(
        'telegram_ingested_files',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('file_unique_id', sa.Text(), nullable=False, unique=True),
        sa.Column('telegram_update_id', sa.BigInteger(), nullable=True),
        sa.Column('telegram_user_id', sa.BigInteger(), nullable=True),
        sa.Column('telegram_username', sa.Text(), nullable=True),
        sa.Column('telegram_chat_id', sa.BigInteger(), nullable=True),
        sa.Column('message_timestamp', sa.DateTime(timezone=True), nullable=True),
        sa.Column('work_card_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('work_cards.id'), nullable=True),
        sa.Column('status', sa.Text(), nullable=False),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('processed_at', sa.DateTime(timezone=True), nullable=True),
    )

    op.create_table(
        'telegram_polling_state',
        sa.Column('id', sa.Integer(), primary_key=True),
        sa.Column('last_offset', sa.BigInteger(), nullable=False, server_default=sa.text('0')),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    # Seed the single row
    op.execute("INSERT INTO telegram_polling_state (id, last_offset) VALUES (1, 0) ON CONFLICT DO NOTHING")


def downgrade():
    op.drop_table('telegram_polling_state')
    op.drop_table('telegram_ingested_files')
    op.drop_index('ix_telegram_bot_config_chat_id', table_name='telegram_bot_configs')
    op.drop_table('telegram_bot_configs')
