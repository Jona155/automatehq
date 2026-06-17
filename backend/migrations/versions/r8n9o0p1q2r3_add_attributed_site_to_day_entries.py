"""add attributed_site_id to work_card_day_entries

Per-day site override: a day's hours are attributed to attributed_site_id when
set, otherwise they inherit the parent work_card.site_id. Enables splitting an
employee's monthly hours across multiple sites on a single (managed) work card.

Revision ID: r8n9o0p1q2r3
Revises: q7m8n9o0p1q2
Create Date: 2026-06-17 00:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID

# revision identifiers, used by Alembic.
revision = 'r8n9o0p1q2r3'
down_revision = 'q7m8n9o0p1q2'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('work_card_day_entries',
        sa.Column('attributed_site_id', UUID(as_uuid=True), nullable=True))
    op.create_foreign_key(
        'fk_work_card_day_entries_attributed_site',
        'work_card_day_entries', 'sites',
        ['attributed_site_id'], ['id'])
    # Export aggregation looks up entries by attributed_site_id, so index it.
    op.create_index(
        'ix_work_card_day_entries_attributed_site_id',
        'work_card_day_entries', ['attributed_site_id'])


def downgrade():
    op.drop_index('ix_work_card_day_entries_attributed_site_id', table_name='work_card_day_entries')
    op.drop_constraint('fk_work_card_day_entries_attributed_site', 'work_card_day_entries', type_='foreignkey')
    op.drop_column('work_card_day_entries', 'attributed_site_id')
