import sys
from dotenv import load_dotenv
load_dotenv()

from sqlalchemy import inspect
from backend.app import create_app
from backend.app.extensions import db

def verify_schema():
    app = create_app()
    with app.app_context():
        inspector = inspect(db.engine)
        tables = inspector.get_table_names()
        
        expected_tables = [
            'users', 'sites', 'employees', 'work_cards', 'work_card_files',
            'work_card_extraction', 'work_card_day_entries', 'export_runs', 'audit_events',
            'alembic_version'
        ]
        
        missing_tables = [t for t in expected_tables if t not in tables]
        if missing_tables:
            print(f"FAIL - Missing tables: {missing_tables}")
            sys.exit(1)
        else:
            print("OK - All tables present")

        # Check indexes for employees
        indexes = inspector.get_indexes('employees')
        index_names = [i['name'] for i in indexes]
        if 'ix_employees_passport_id' in index_names and 'ix_employees_site_id' in index_names:
             print("OK - Employee indexes present")
        else:
             print(f"FAIL - Employee indexes missing: {index_names}")

        # Check unique constraint on work_card_files
        unique_constraints = inspector.get_unique_constraints('work_card_files')
        has_unique = any(c['column_names'] == ['work_card_id'] for c in unique_constraints)
        if has_unique:
            print("OK - work_card_files 1:1 constraint present")
        else:
            print(f"WARN - work_card_files 1:1 constraint might be missing or named differently: {unique_constraints}")

        print("\nSchema verification complete.")

if __name__ == "__main__":
    verify_schema()
