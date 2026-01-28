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

    # 2. Add business_id (nullable first) to all tables
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=True))

    with op.batch_alter_table('sites', schema=None) as batch_op:
        batch_op.add_column(sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=True))

    with op.batch_alter_table('employees', schema=None) as batch_op:
        batch_op.add_column(sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=True))

    with op.batch_alter_table('work_cards', schema=None) as batch_op:
        batch_op.add_column(sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=True))

    with op.batch_alter_table('export_runs', schema=None) as batch_op:
        batch_op.add_column(sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=True))

    with op.batch_alter_table('audit_events', schema=None) as batch_op:
        batch_op.add_column(sa.Column('business_id', postgresql.UUID(as_uuid=True), nullable=True))

    # 3. Data migration - create businesses from distinct user business_names
    conn = op.get_bind()
    
    # Get distinct business_names from users
    result = conn.execute(sa.text("SELECT DISTINCT business_name FROM users WHERE business_name IS NOT NULL"))
    business_names = [row[0] for row in result]
    
    # Create a default business for users without business_name
    default_business_id = uuid.uuid4()
    conn.execute(sa.text("""
        INSERT INTO businesses (id, name, code, is_active, created_at, updated_at)
        VALUES (:id, 'AutomateHQ', 'automatehq', true, NOW(), NOW())
    """), {'id': default_business_id})
    
    # Track business name to ID mapping
    business_map = {'AutomateHQ': default_business_id}
    
    # Create businesses for each distinct name (skip if it's AutomateHQ)
    for name in business_names:
        if name and name != 'AutomateHQ':
            business_id = uuid.uuid4()
            code = slugify(name)
            # Handle potential code collisions
            base_code = code
            counter = 1
            while True:
                existing = conn.execute(
                    sa.text("SELECT 1 FROM businesses WHERE code = :code"),
                    {'code': code}
                ).fetchone()
                if not existing:
                    break
                code = f"{base_code}-{counter}"
                counter += 1
            
            conn.execute(sa.text("""
                INSERT INTO businesses (id, name, code, is_active, created_at, updated_at)
                VALUES (:id, :name, :code, true, NOW(), NOW())
            """), {'id': business_id, 'name': name, 'code': code})
            business_map[name] = business_id
    
    # 4. Update users with business_id
    for name, business_id in business_map.items():
        conn.execute(sa.text("""
            UPDATE users SET business_id = :business_id WHERE business_name = :name
        """), {'business_id': business_id, 'name': name})
    
    # Update users without business_name to default
    conn.execute(sa.text("""
        UPDATE users SET business_id = :business_id WHERE business_name IS NULL
    """), {'business_id': default_business_id})
    
    # 5. Update work_cards - infer from uploaded_by_user_id
    conn.execute(sa.text("""
        UPDATE work_cards wc
        SET business_id = u.business_id
        FROM users u
        WHERE wc.uploaded_by_user_id = u.id
    """))
    
    # For work_cards without uploaded_by_user_id, try via site
    conn.execute(sa.text("""
        UPDATE work_cards wc
        SET business_id = s.business_id
        FROM sites s
        WHERE wc.business_id IS NULL AND wc.site_id = s.id AND s.business_id IS NOT NULL
    """))
    
    # Remaining work_cards get default business
    conn.execute(sa.text("""
        UPDATE work_cards SET business_id = :business_id WHERE business_id IS NULL
    """), {'business_id': default_business_id})
    
    # 6. Update export_runs - infer from exported_by_user_id
    conn.execute(sa.text("""
        UPDATE export_runs er
        SET business_id = u.business_id
        FROM users u
        WHERE er.exported_by_user_id = u.id
    """))
    
    # Remaining export_runs get default business
    conn.execute(sa.text("""
        UPDATE export_runs SET business_id = :business_id WHERE business_id IS NULL
    """), {'business_id': default_business_id})
    
    # 7. Update audit_events - infer from actor_user_id
    conn.execute(sa.text("""
        UPDATE audit_events ae
        SET business_id = u.business_id
        FROM users u
        WHERE ae.actor_user_id = u.id
    """))
    
    # Remaining audit_events get default business
    conn.execute(sa.text("""
        UPDATE audit_events SET business_id = :business_id WHERE business_id IS NULL
    """), {'business_id': default_business_id})
    
    # 8. Update sites - infer from work_cards or default
    conn.execute(sa.text("""
        UPDATE sites s
        SET business_id = (
            SELECT wc.business_id FROM work_cards wc 
            WHERE wc.site_id = s.id 
            LIMIT 1
        )
        WHERE s.business_id IS NULL
    """))
    
    # Remaining sites get default business
    conn.execute(sa.text("""
        UPDATE sites SET business_id = :business_id WHERE business_id IS NULL
    """), {'business_id': default_business_id})
    
    # 9. Update employees - infer from site
    conn.execute(sa.text("""
        UPDATE employees e
        SET business_id = s.business_id
        FROM sites s
        WHERE e.site_id = s.id
    """))
    
    # Remaining employees get default business
    conn.execute(sa.text("""
        UPDATE employees SET business_id = :business_id WHERE business_id IS NULL
    """), {'business_id': default_business_id})
    
    # 10. Make business_id NOT NULL and add foreign keys and indexes
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.alter_column('business_id', nullable=False)
        batch_op.create_foreign_key('fk_users_business_id', 'businesses', ['business_id'], ['id'])
        batch_op.create_index('ix_users_business_id', ['business_id'])
        batch_op.drop_column('business_name')

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
    # Re-add business_name to users
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('business_name', sa.Text(), nullable=True))
    
    # Copy business names back
    conn = op.get_bind()
    conn.execute(sa.text("""
        UPDATE users u SET business_name = b.name
        FROM businesses b WHERE u.business_id = b.id
    """))
    
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
