import os
from dotenv import load_dotenv
from werkzeug.security import generate_password_hash
from app import create_app
from app.repositories.user_repository import UserRepository
from app.repositories.business_repository import BusinessRepository

load_dotenv()

def seed_admin():
    app = create_app()
    with app.app_context():
        user_repo = UserRepository()
        business_repo = BusinessRepository()
        
        # Get or create Mizhav business (should exist from migration)
        business = business_repo.get_by_name('Mizhav')
        if not business:
            print("Creating Mizhav business...")
            business = business_repo.create(
                business_name='Mizhav',
                business_code='MIZ',
                is_active=True
            )
        
        print(f"Using business: {business.business_name} (ID: {business.id})")
        
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
                'password_hash': generate_password_hash(password),
                'is_active': True,
                'business_id': business.id
            }
            
            user_repo.create(**user_data)
            print("Admin user created successfully.")
        except Exception as e:
            print(f"Failed to create admin user: {e}")

if __name__ == "__main__":
    seed_admin()
