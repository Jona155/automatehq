import os
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash
from app import create_app
from app.repositories.business_repository import BusinessRepository
from app.repositories.user_repository import UserRepository

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


def seed_admin():
    app = create_app()
    with app.app_context():
        # First ensure default business exists
        business = seed_business()
        if not business:
            print("Cannot create admin user without a business.")
            return
        
        user_repo = UserRepository()
        
        email = os.environ.get('ADMIN_EMAIL', 'admin@example.com')
        password = os.environ.get('ADMIN_PASSWORD', 'password123')
        
        existing_user = user_repo.get_by_email(email)
        if existing_user:
            print(f"Admin user {email} already exists.")
            return

        print(f"Creating admin user {email}...")
        
        try:
            user_data = {
                'full_name': 'System Admin',
                'email': email,
                'role': 'ADMIN',
                'business_id': business.id,
                'password_hash': generate_password_hash(password),
                'is_active': True
            }
            
            user_repo.create(**user_data)
            print("Admin user created successfully.")
        except Exception as e:
            print(f"Failed to create admin user: {e}")


if __name__ == "__main__":
    seed_admin()
