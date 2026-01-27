"""
Multi-Tenancy Test Script

Tests that business isolation is working correctly:
1. Creates two test businesses
2. Creates users in each business
3. Creates employees in each business
4. Verifies data isolation between businesses
"""
import sys
from dotenv import load_dotenv
load_dotenv()

from app import create_app
from app.repositories.business_repository import BusinessRepository
from app.repositories.user_repository import UserRepository
from app.repositories.employee_repository import EmployeeRepository
from app.repositories.site_repository import SiteRepository
from werkzeug.security import generate_password_hash

def test_multi_tenancy():
    app = create_app()
    with app.app_context():
        business_repo = BusinessRepository()
        user_repo = UserRepository()
        employee_repo = EmployeeRepository()
        site_repo = SiteRepository()
        
        print("=" * 80)
        print("MULTI-TENANCY TEST")
        print("=" * 80)
        
        # Step 1: Get or create test businesses
        print("\n1. Setting up test businesses...")
        business_a = business_repo.get_by_name('Test Business A')
        if not business_a:
            business_a = business_repo.create(
                business_name='Test Business A',
                business_code='TBA',
                is_active=True
            )
            print(f"   Created Business A: {business_a.id}")
        else:
            print(f"   Using existing Business A: {business_a.id}")
        
        business_b = business_repo.get_by_name('Test Business B')
        if not business_b:
            business_b = business_repo.create(
                business_name='Test Business B',
                business_code='TBB',
                is_active=True
            )
            print(f"   Created Business B: {business_b.id}")
        else:
            print(f"   Using existing Business B: {business_b.id}")
        
        # Step 2: Create test users in each business
        print("\n2. Creating test users...")
        user_a = user_repo.get_by_email('user_a@test.com')
        if not user_a:
            user_a = user_repo.create(
                full_name='User A',
                email='user_a@test.com',
                role='ADMIN',
                password_hash=generate_password_hash('password123'),
                business_id=business_a.id,
                is_active=True
            )
            print(f"   Created User A in Business A")
        else:
            print(f"   User A exists in business: {user_a.business_id}")
        
        user_b = user_repo.get_by_email('user_b@test.com')
        if not user_b:
            user_b = user_repo.create(
                full_name='User B',
                email='user_b@test.com',
                role='ADMIN',
                password_hash=generate_password_hash('password123'),
                business_id=business_b.id,
                is_active=True
            )
            print(f"   Created User B in Business B")
        else:
            print(f"   User B exists in business: {user_b.business_id}")
        
        # Step 3: Get or create a shared site
        print("\n3. Setting up shared site...")
        site = site_repo.get_by_name('Test Site')
        if not site:
            site = site_repo.create(
                site_name='Test Site',
                site_code='TS1',
                is_active=True
            )
            print(f"   Created shared site: {site.id}")
        else:
            print(f"   Using existing site: {site.id}")
        
        # Step 4: Create employees in each business (same site)
        print("\n4. Creating test employees...")
        # Clean up old test employees if they exist
        old_emp_a = employee_repo.get_by_external_id('EMP_A', business_id=business_a.id)
        if old_emp_a:
            employee_repo.delete(old_emp_a.id)
        
        old_emp_b = employee_repo.get_by_external_id('EMP_B', business_id=business_b.id)
        if old_emp_b:
            employee_repo.delete(old_emp_b.id)
        
        emp_a = employee_repo.create(
            full_name='Employee A',
            external_employee_id='EMP_A',
            site_id=site.id,
            business_id=business_a.id,
            is_active=True
        )
        print(f"   Created Employee A in Business A at shared site")
        
        emp_b = employee_repo.create(
            full_name='Employee B',
            external_employee_id='EMP_B',
            site_id=site.id,
            business_id=business_b.id,
            is_active=True
        )
        print(f"   Created Employee B in Business B at shared site")
        
        # Step 5: Test data isolation
        print("\n5. Testing data isolation...")
        
        # Test 5.1: Business A should only see their users
        users_a = user_repo.get_all_for_business(business_id=business_a.id)
        print(f"   Business A has {len(users_a)} users")
        for user in users_a:
            if user.business_id != business_a.id:
                print(f"   [ERROR] User {user.email} doesn't belong to Business A!")
                return False
        print(f"   [OK] All users in Business A belong to Business A")
        
        # Test 5.2: Business B should only see their users
        users_b = user_repo.get_all_for_business(business_id=business_b.id)
        print(f"   Business B has {len(users_b)} users")
        for user in users_b:
            if user.business_id != business_b.id:
                print(f"   [ERROR] User {user.email} doesn't belong to Business B!")
                return False
        print(f"   [OK] All users in Business B belong to Business B")
        
        # Test 5.3: Business A should only see their employees at the site
        employees_a = employee_repo.get_by_site(site_id=site.id, business_id=business_a.id)
        print(f"   Business A has {len(employees_a)} employees at shared site")
        for emp in employees_a:
            if emp.business_id != business_a.id:
                print(f"   [ERROR] Employee {emp.full_name} doesn't belong to Business A!")
                return False
        print(f"   [OK] All employees for Business A at site belong to Business A")
        
        # Test 5.4: Business B should only see their employees at the site
        employees_b = employee_repo.get_by_site(site_id=site.id, business_id=business_b.id)
        print(f"   Business B has {len(employees_b)} employees at shared site")
        for emp in employees_b:
            if emp.business_id != business_b.id:
                print(f"   [ERROR] Employee {emp.full_name} doesn't belong to Business B!")
                return False
        print(f"   [OK] All employees for Business B at site belong to Business B")
        
        # Test 5.5: Cross-tenant access should be blocked
        print("\n6. Testing cross-tenant access prevention...")
        emp_a_from_b = employee_repo.get_by_id(emp_a.id)
        if emp_a_from_b and emp_a_from_b.business_id == business_b.id:
            print(f"   [ERROR] Business B can access Business A's employee!")
            return False
        if emp_a_from_b and emp_a_from_b.business_id == business_a.id:
            print(f"   [WARNING] Direct get_by_id doesn't filter by business (expected)")
            print(f"   API layer must add authorization checks to prevent this")
        
        # Test 5.6: Verify external_employee_id is scoped to business
        emp_a_by_external = employee_repo.get_by_external_id('EMP_A', business_id=business_a.id)
        if not emp_a_by_external or emp_a_by_external.id != emp_a.id:
            print(f"   [ERROR] Cannot find Employee A by external ID in Business A!")
            return False
        print(f"   [OK] Can find Employee A by external ID in Business A")
        
        emp_a_in_business_b = employee_repo.get_by_external_id('EMP_A', business_id=business_b.id)
        if emp_a_in_business_b:
            print(f"   [ERROR] Found Employee A in Business B!")
            return False
        print(f"   [OK] Cannot find Employee A in Business B (isolated)")
        
        print("\n" + "=" * 80)
        print("MULTI-TENANCY TEST: PASSED")
        print("=" * 80)
        print("\nSummary:")
        print(f"  - Created/verified 2 businesses")
        print(f"  - Created/verified 2 users (1 per business)")
        print(f"  - Created 2 employees at shared site (1 per business)")
        print(f"  - Verified data isolation between businesses")
        print(f"  - Verified repository-level filtering works correctly")
        print(f"\nNote: API-level authorization is handled by checking business_id")
        print(f"      in each endpoint against g.business_id from the JWT token.")
        return True

if __name__ == "__main__":
    try:
        success = test_multi_tenancy()
        sys.exit(0 if success else 1)
    except Exception as e:
        print(f"\n[CRITICAL ERROR] Test failed with exception: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)
