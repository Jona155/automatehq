"""add_whatsapp_tables

Revision ID: k1f2g3h4i5j6
Revises: j0e1f2g3h4i5
Create Date: 2026-04-20 19:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'k1f2g3h4i5j6'
down_revision = 'j0e1f2g3h4i5'
branch_labels = None
depends_on = None


def upgrade():
    # One config per business — same pattern as telegram_bot_configs.
    # Images arriving on the linked group are ingested with site_id=None; the
    # extractor + employee matcher assigns them to a site downstream.
    op.create_table(
        'whatsapp_group_configs',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('business_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('businesses.id'), nullable=False, unique=True),
        sa.Column('chat_id', sa.Text(), nullable=False, unique=True),
        sa.Column('chat_name', sa.Text(), nullable=True),
        sa.Column('current_processing_month', sa.Date(), nullable=False),
        sa.Column('auto_advance_day', sa.SmallInteger(), nullable=True),
        sa.Column('last_seen_timestamp', sa.DateTime(timezone=True), nullable=True),
        sa.Column('is_active', sa.Boolean(), nullable=False, server_default=sa.text('true')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_whatsapp_group_configs_chat_id', 'whatsapp_group_configs', ['chat_id'])

    op.create_table(
        'whatsapp_ingested_messages',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('message_id', sa.Text(), nullable=False, unique=True),
        sa.Column('chat_id', sa.Text(), nullable=False),
        sa.Column('chat_name', sa.Text(), nullable=True),
        sa.Column('sender', sa.Text(), nullable=True),
        sa.Column('push_name', sa.Text(), nullable=True),
        sa.Column('message_timestamp', sa.DateTime(timezone=True), nullable=True),
        sa.Column('work_card_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('work_cards.id'), nullable=True),
        sa.Column('status', sa.Text(), nullable=False),
        sa.Column('error_message', sa.Text(), nullable=True),
        sa.Column('caption', sa.Text(), nullable=True),
        sa.Column('processed_at', sa.DateTime(timezone=True), nullable=True),
    )
    op.create_index('ix_whatsapp_ingested_messages_chat_id', 'whatsapp_ingested_messages', ['chat_id'])


def downgrade():
    op.drop_index('ix_whatsapp_ingested_messages_chat_id', table_name='whatsapp_ingested_messages')
    op.drop_table('whatsapp_ingested_messages')
    op.drop_index('ix_whatsapp_group_configs_chat_id', table_name='whatsapp_group_configs')
    op.drop_table('whatsapp_group_configs')
