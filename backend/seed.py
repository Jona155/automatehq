import os
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash
from app import create_app
from app.repositories.business_repository import BusinessRepository
from app.repositories.user_repository import UserRepository
from app.repositories.site_repository import SiteRepository
from app.repositories.employee_repository import EmployeeRepository

load_dotenv()


def seed_business():
    """Seed the default business if it doesn't exist."""
    business_repo = BusinessRepository()

    existing_business = business_repo.get_by_code('automatehq')
    if existing_business:
        print("Default business 'AutomateHQ' already exists.")
        return existing_business

    print("Creating default business 'AutomateHQ'...")
    try:
        business = business_repo.create(
            name='AutomateHQ',
            code='automatehq',
            is_active=True
        )
        print("Default business created successfully.")
        return business
    except Exception as e:
        print(f"Failed to create default business: {e}")
        return None


def seed_admin(business):
    """Seed the default admin user if it doesn't exist."""
    user_repo = UserRepository()

    email = os.environ.get('ADMIN_EMAIL', 'admin@example.com')
    password = os.environ.get('ADMIN_PASSWORD', 'password123')

    existing_user = user_repo.get_by_email(email)
    if existing_user:
        print(f"Admin user {email} already exists.")
        return

    print(f"Creating admin user {email}...")

    try:
        user_repo.create(
            full_name='System Admin',
            email=email,
            role='ADMIN',
            business_id=business.id,
            password_hash=generate_password_hash(password, method='pbkdf2:sha256'),
            is_active=True,
        )
        print("Admin user created successfully.")
    except Exception as e:
        print(f"Failed to create admin user: {e}")


def seed_site(business):
    """Seed a demo site if it doesn't exist."""
    site_repo = SiteRepository()

    existing_site = site_repo.get_by_name_and_business('Tel Aviv HQ', business.id)
    if existing_site:
        print("Demo site 'Tel Aviv HQ' already exists.")
        return existing_site

    print("Creating demo site 'Tel Aviv HQ'...")
    try:
        site = site_repo.create(
            site_name='Tel Aviv HQ',
            site_code='TLV-001',
            business_id=business.id,
            is_active=True,
        )
        print("Demo site created successfully.")
        return site
    except Exception as e:
        print(f"Failed to create demo site: {e}")
        return None


DEMO_EMPLOYEES = [
    {'full_name': 'David Cohen', 'passport_id': 'IL-100001', 'phone_number': '050-1111111'},
    {'full_name': 'Maria Santos', 'passport_id': 'BR-200002', 'phone_number': '050-2222222'},
    {'full_name': 'Ahmed Hassan', 'passport_id': 'EG-300003', 'phone_number': '050-3333333'},
    {'full_name': 'Elena Popov', 'passport_id': 'RO-400004', 'phone_number': '050-4444444'},
    {'full_name': 'Wei Zhang', 'passport_id': 'CN-500005', 'phone_number': '050-5555555'},
]


def seed_employees(business, site):
    """Seed demo employees if they don't exist."""
    employee_repo = EmployeeRepository()

    for emp in DEMO_EMPLOYEES:
        existing = employee_repo.get_by_passport(emp['passport_id'], business.id)
        if existing:
            print(f"  Employee '{emp['full_name']}' already exists.")
            continue

        try:
            employee_repo.create(
                full_name=emp['full_name'],
                passport_id=emp['passport_id'],
                phone_number=emp['phone_number'],
                business_id=business.id,
                site_id=site.id,
                is_active=True,
            )
            print(f"  Created employee '{emp['full_name']}'.")
        except Exception as e:
            print(f"  Failed to create employee '{emp['full_name']}': {e}")


def seed_all():
    app = create_app()
    with app.app_context():
        business = seed_business()
        if not business:
            print("Cannot seed without a business.")
            return

        seed_admin(business)

        site = seed_site(business)
        if not site:
            print("Cannot seed employees without a site.")
            return

        print("Creating demo employees...")
        seed_employees(business, site)

        print("\nSeed complete!")


if __name__ == "__main__":
    seed_all()
