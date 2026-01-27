"""add_multi_tenancy_businesses_and_business_id

Revision ID: 565101c9853b
Revises: b8df332d58c2
Create Date: 2026-01-27 09:30:36.588502

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '565101c9853b'
down_revision = 'b8df332d58c2'
branch_labels = None
depends_on = None


def upgrade():
    # Step 1: Create businesses table
    op.create_table('businesses',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('business_name', sa.Text(), nullable=False),
    sa.Column('business_code', sa.Text(), nullable=True),
    sa.Column('is_active', sa.Boolean(), nullable=True),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=True),
    sa.Column('updated_at', sa.DateTime(timezone=True), nullable=True),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('business_name')
    )
    
    # Step 2: Insert default Mizhav business and capture its ID
    connection = op.get_bind()
    result = connection.execute(sa.text("""
        INSERT INTO businesses (id, business_name, business_code, is_active, created_at, updated_at)
        VALUES (gen_random_uuid(), 'Mizhav', 'MIZ', true, NOW(), NOW())
        RETURNING id
    """))
    mizhav_id = result.fetchone()[0]
    
    # Step 3: Add business_id columns as NULLABLE initially
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.add_column(sa.Column('business_id', sa.UUID(), nullable=True))
    
    with op.batch_alter_table('employees', schema=None) as batch_op:
        batch_op.add_column(sa.Column('business_id', sa.UUID(), nullable=True))
    
    with op.batch_alter_table('work_cards', schema=None) as batch_op:
        batch_op.add_column(sa.Column('business_id', sa.UUID(), nullable=True))
    
    with op.batch_alter_table('export_runs', schema=None) as batch_op:
        batch_op.add_column(sa.Column('business_id', sa.UUID(), nullable=True))
    
    with op.batch_alter_table('audit_events', schema=None) as batch_op:
        batch_op.add_column(sa.Column('business_id', sa.UUID(), nullable=True))
    
    # Step 4: Backfill business_id with Mizhav business ID
    connection.execute(sa.text(f"UPDATE users SET business_id = '{mizhav_id}' WHERE business_id IS NULL"))
    connection.execute(sa.text(f"UPDATE employees SET business_id = '{mizhav_id}' WHERE business_id IS NULL"))
    connection.execute(sa.text(f"UPDATE work_cards SET business_id = '{mizhav_id}' WHERE business_id IS NULL"))
    connection.execute(sa.text(f"UPDATE export_runs SET business_id = '{mizhav_id}' WHERE business_id IS NULL"))
    connection.execute(sa.text(f"UPDATE audit_events SET business_id = '{mizhav_id}' WHERE business_id IS NULL"))
    
    # Step 5: Make business_id NOT NULL and add foreign keys + indexes
    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.alter_column('business_id', nullable=False)
        batch_op.create_index('ix_users_business_id', ['business_id'], unique=False)
        batch_op.create_foreign_key('fk_users_business_id', 'businesses', ['business_id'], ['id'])

    with op.batch_alter_table('employees', schema=None) as batch_op:
        batch_op.alter_column('business_id', nullable=False)
        batch_op.create_index('ix_employees_business_passport', ['business_id', 'passport_id'], unique=False, postgresql_where=sa.text('passport_id IS NOT NULL'))
        batch_op.create_index('ix_employees_business_site', ['business_id', 'site_id'], unique=False)
        batch_op.create_foreign_key('fk_employees_business_id', 'businesses', ['business_id'], ['id'])

    with op.batch_alter_table('work_cards', schema=None) as batch_op:
        batch_op.alter_column('business_id', nullable=False)
        batch_op.drop_index(batch_op.f('ix_work_cards_employee_month'))
        batch_op.drop_index(batch_op.f('ix_work_cards_site_month'))
        batch_op.create_index('ix_work_cards_business_employee_month', ['business_id', 'employee_id', 'processing_month'], unique=False)
        batch_op.create_index('ix_work_cards_business_id', ['business_id'], unique=False)
        batch_op.create_index('ix_work_cards_business_site_month', ['business_id', 'site_id', 'processing_month'], unique=False)
        batch_op.create_foreign_key('fk_work_cards_business_id', 'businesses', ['business_id'], ['id'])

    with op.batch_alter_table('export_runs', schema=None) as batch_op:
        batch_op.alter_column('business_id', nullable=False)
        batch_op.drop_index(batch_op.f('ix_export_runs_month_site'))
        batch_op.create_index('ix_export_runs_business_id', ['business_id'], unique=False)
        batch_op.create_index('ix_export_runs_business_month_site', ['business_id', 'processing_month', 'site_id'], unique=False)
        batch_op.create_foreign_key('fk_export_runs_business_id', 'businesses', ['business_id'], ['id'])

    with op.batch_alter_table('audit_events', schema=None) as batch_op:
        batch_op.alter_column('business_id', nullable=False)
        batch_op.drop_index(batch_op.f('ix_audit_events_site_time'))
        batch_op.create_index('ix_audit_events_business_id', ['business_id'], unique=False)
        batch_op.create_index('ix_audit_events_business_site_time', ['business_id', 'site_id', 'created_at'], unique=False)
        batch_op.create_foreign_key('fk_audit_events_business_id', 'businesses', ['business_id'], ['id'])


def downgrade():
    # Reverse order: drop foreign keys, indexes, columns, then table
    with op.batch_alter_table('audit_events', schema=None) as batch_op:
        batch_op.drop_constraint('fk_audit_events_business_id', type_='foreignkey')
        batch_op.drop_index('ix_audit_events_business_site_time')
        batch_op.drop_index('ix_audit_events_business_id')
        batch_op.create_index(batch_op.f('ix_audit_events_site_time'), ['site_id', 'created_at'], unique=False)
        batch_op.drop_column('business_id')

    with op.batch_alter_table('export_runs', schema=None) as batch_op:
        batch_op.drop_constraint('fk_export_runs_business_id', type_='foreignkey')
        batch_op.drop_index('ix_export_runs_business_month_site')
        batch_op.drop_index('ix_export_runs_business_id')
        batch_op.create_index(batch_op.f('ix_export_runs_month_site'), ['processing_month', 'site_id'], unique=False)
        batch_op.drop_column('business_id')

    with op.batch_alter_table('work_cards', schema=None) as batch_op:
        batch_op.drop_constraint('fk_work_cards_business_id', type_='foreignkey')
        batch_op.drop_index('ix_work_cards_business_site_month')
        batch_op.drop_index('ix_work_cards_business_id')
        batch_op.drop_index('ix_work_cards_business_employee_month')
        batch_op.create_index(batch_op.f('ix_work_cards_site_month'), ['site_id', 'processing_month'], unique=False)
        batch_op.create_index(batch_op.f('ix_work_cards_employee_month'), ['employee_id', 'processing_month'], unique=False)
        batch_op.drop_column('business_id')

    with op.batch_alter_table('employees', schema=None) as batch_op:
        batch_op.drop_constraint('fk_employees_business_id', type_='foreignkey')
        batch_op.drop_index('ix_employees_business_site')
        batch_op.drop_index('ix_employees_business_passport', postgresql_where=sa.text('passport_id IS NOT NULL'))
        batch_op.drop_column('business_id')

    with op.batch_alter_table('users', schema=None) as batch_op:
        batch_op.drop_constraint('fk_users_business_id', type_='foreignkey')
        batch_op.drop_index('ix_users_business_id')
        batch_op.drop_column('business_id')

    op.drop_table('businesses')
