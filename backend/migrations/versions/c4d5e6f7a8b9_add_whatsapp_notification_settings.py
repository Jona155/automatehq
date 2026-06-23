"""add_whatsapp_notification_settings

Adds the whatsapp_notification_settings table (per-business config for
'new card arrived' alerts) and the work_cards.whatsapp_notified_at dedup column.

Revision ID: c4d5e6f7a8b9
Revises: e07d406479e1
Create Date: 2026-06-23 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision = 'c4d5e6f7a8b9'
down_revision = 'e07d406479e1'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'whatsapp_notification_settings',
        sa.Column('id', postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column('business_id', postgresql.UUID(as_uuid=True), sa.ForeignKey('businesses.id'), nullable=False, unique=True),
        sa.Column('enabled', sa.Boolean(), nullable=False, server_default=sa.text('false')),
        sa.Column('start_day', sa.SmallInteger(), nullable=False, server_default='1'),
        sa.Column('end_day', sa.SmallInteger(), nullable=False, server_default='31'),
        sa.Column('destination_user_ids', postgresql.JSONB(), nullable=False, server_default=sa.text("'[]'::jsonb")),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    )

    with op.batch_alter_table('work_cards', schema=None) as batch_op:
        batch_op.add_column(sa.Column('whatsapp_notified_at', sa.DateTime(timezone=True), nullable=True))


def downgrade():
    with op.batch_alter_table('work_cards', schema=None) as batch_op:
        batch_op.drop_column('whatsapp_notified_at')

    op.drop_table('whatsapp_notification_settings')
