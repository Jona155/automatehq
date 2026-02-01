"""restore_business_entity

Revision ID: c1a2b3d4e5f6
Revises: be20b2a9c359
Create Date: 2026-01-27 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql
import uuid
import re

# revision identifiers, used by Alembic.
revision = 'c1a2b3d4e5f6'
down_revision = 'be20b2a9c359'
branch_labels = None
depends_on = None


def slugify(text):
    """Convert text to URL-friendly slug."""
    if not text:
        return 'default'
    # Lowercase and replace spaces/special chars with hyphens
    text = text.lower().strip()
    text = re.sub(r'[^\w\s-]', '', text)
    text = re.sub(r'[\s_-]+', '-', text)
    text = text.strip('-')
    return text or 'default'


def upgrade():
    # 1. Create businesses table
    op.create_table('businesses',
        sa.Column('id', postgresql.UUID(as_uuid=True), nullable=False, default=uuid.uuid4),
        sa.Column('name', sa.Text(), nullable=False),
        sa.Column('code', sa.Text(), nullable=False),
        sa.Column('is_active', sa.Boolean(), nullable=True, default=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('code', name='uq_businesses_code')
    )

    # 2. Create a default business
    conn = op.get_bind()
    default_business_id = uuid.uuid4()
    conn.execute(sa.text("""
        INSERT INTO businesses (id, name, code, is_active, created_at, updated_at)
        VALUES (:id, 'AutomateHQ', 'automatehq', true, NOW(), NOW())
    """), {'id': default_business_id})

    # 3. Add business_id to all tables (with default value)
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=True))
    conn.execute(sa.text("UPDATE users SET business_id = :id"), {'id': default_business_id})

    with op.batch_alter_table('sites', schema=None) as batch_op:
        batch_op.add_column(sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=True))
    conn.execute(sa.text("UPDATE sites SET business_id = :id"), {'id': default_business_id})

    with op.batch_alter_table('employees', schema=None) as batch_op:
        batch_op.add_column(sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=True))
    conn.execute(sa.text("UPDATE employees SET business_id = :id"), {'id': default_business_id})

    with op.batch_alter_table('work_cards', schema=None) as batch_op:
        batch_op.add_column(sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=True))
    conn.execute(sa.text("UPDATE work_cards SET business_id = :id"), {'id': default_business_id})

    with op.batch_alter_table('export_runs', schema=None) as batch_op:
        batch_op.add_column(sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=True))
    conn.execute(sa.text("UPDATE export_runs SET business_id = :id"), {'id': default_business_id})

    with op.batch_alter_table('audit_events', schema=None) as batch_op:
        batch_op.add_column(sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=True))
    conn.execute(sa.text("UPDATE audit_events SET business_id = :id"), {'id': default_business_id})

    # 4. Make business_id NOT NULL and add foreign keys and indexes
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.alter_column('business_id', nullable=False)
        batch_op.create_foreign_key('fk_users_business_id', 'businesses', ['business_id'], ['id'])
        batch_op.create_index('ix_users_business_id', ['business_id'])

    with op.batch_alter_table('sites', schema=None) as batch_op:
        batch_op.alter_column('business_id', nullable=False)
        batch_op.create_foreign_key('fk_sites_business_id', 'businesses', ['business_id'], ['id'])
        batch_op.create_index('ix_sites_business_id', ['business_id'])
        batch_op.drop_constraint('sites_site_name_key', type_='unique')
        batch_op.create_unique_constraint('uq_sites_business_name', ['business_id', 'site_name'])

    with op.batch_alter_table('employees', schema=None) as batch_op:
        batch_op.alter_column('business_id', nullable=False)
        batch_op.create_foreign_key('fk_employees_business_id', 'businesses', ['business_id'], ['id'])
        batch_op.create_index('ix_employees_business_id', ['business_id'])
        # Drop old unique index on passport_id and create business-scoped one
        batch_op.drop_index('ix_employees_passport_id')
        batch_op.create_index('ix_employees_business_passport', ['business_id', 'passport_id'], unique=True, postgresql_where=sa.text('passport_id IS NOT NULL'))

    with op.batch_alter_table('work_cards', schema=None) as batch_op:
        batch_op.alter_column('business_id', nullable=False)
        batch_op.create_foreign_key('fk_work_cards_business_id', 'businesses', ['business_id'], ['id'])
        batch_op.create_index('ix_work_cards_business_id', ['business_id'])
        batch_op.drop_index('ix_work_cards_site_month')
        batch_op.create_index('ix_work_cards_business_site_month', ['business_id', 'site_id', 'processing_month'])

    with op.batch_alter_table('export_runs', schema=None) as batch_op:
        batch_op.alter_column('business_id', nullable=False)
        batch_op.create_foreign_key('fk_export_runs_business_id', 'businesses', ['business_id'], ['id'])
        batch_op.create_index('ix_export_runs_business_id', ['business_id'])
        batch_op.drop_index('ix_export_runs_month_site')
        batch_op.create_index('ix_export_runs_business_month_site', ['business_id', 'processing_month', 'site_id'])

    with op.batch_alter_table('audit_events', schema=None) as batch_op:
        batch_op.alter_column('business_id', nullable=False)
        batch_op.create_foreign_key('fk_audit_events_business_id', 'businesses', ['business_id'], ['id'])
        batch_op.create_index('ix_audit_events_business_id', ['business_id'])
        batch_op.drop_index('ix_audit_events_site_time')
        batch_op.create_index('ix_audit_events_business_site_time', ['business_id', 'site_id', 'created_at'])


def downgrade():
    # Drop foreign keys and indexes, remove business_id from all tables
    with op.batch_alter_table('audit_events', schema=None) as batch_op:
        batch_op.drop_index('ix_audit_events_business_site_time')
        batch_op.drop_index('ix_audit_events_business_id')
        batch_op.drop_constraint('fk_audit_events_business_id', type_='foreignkey')
        batch_op.create_index('ix_audit_events_site_time', ['site_id', 'created_at'])
        batch_op.drop_column('business_id')

    with op.batch_alter_table('export_runs', schema=None) as batch_op:
        batch_op.drop_index('ix_export_runs_business_month_site')
        batch_op.drop_index('ix_export_runs_business_id')
        batch_op.drop_constraint('fk_export_runs_business_id', type_='foreignkey')
        batch_op.create_index('ix_export_runs_month_site', ['processing_month', 'site_id'])
        batch_op.drop_column('business_id')

    with op.batch_alter_table('work_cards', schema=None) as batch_op:
        batch_op.drop_index('ix_work_cards_business_site_month')
        batch_op.drop_index('ix_work_cards_business_id')
        batch_op.drop_constraint('fk_work_cards_business_id', type_='foreignkey')
        batch_op.create_index('ix_work_cards_site_month', ['site_id', 'processing_month'])
        batch_op.drop_column('business_id')

    with op.batch_alter_table('employees', schema=None) as batch_op:
        batch_op.drop_index('ix_employees_business_passport')
        batch_op.drop_index('ix_employees_business_id')
        batch_op.drop_constraint('fk_employees_business_id', type_='foreignkey')
        batch_op.create_index('ix_employees_passport_id', ['passport_id'], unique=True, postgresql_where=sa.text('passport_id IS NOT NULL'))
        batch_op.drop_column('business_id')

    with op.batch_alter_table('sites', schema=None) as batch_op:
        batch_op.drop_constraint('uq_sites_business_name', type_='unique')
        batch_op.create_unique_constraint('sites_site_name_key', ['site_name'])
        batch_op.drop_index('ix_sites_business_id')
        batch_op.drop_constraint('fk_sites_business_id', type_='foreignkey')
        batch_op.drop_column('business_id')

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_index('ix_users_business_id')
        batch_op.drop_constraint('fk_users_business_id', type_='foreignkey')
        batch_op.drop_column('business_id')

    op.drop_table('businesses')
