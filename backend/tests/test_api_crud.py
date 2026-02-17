import unittest
import json
import uuid
import os
from dotenv import load_dotenv

# Load env vars before creating app
load_dotenv()

from backend.app import create_app, db
from backend.app.models.sites import Site, Employee
from backend.app.models.users import User

class TestAPICrud(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.client = self.app.test_client()
        self.app_context = self.app.app_context()
        self.app_context.push()
        
        # Create a clean state if needed, but for now we just rely on unique data
        self.test_site_name = f"Test Site {uuid.uuid4()}"
        self.test_user_email = f"test_{uuid.uuid4()}@example.com"
        
    def tearDown(self):
        # Cleanup
        try:
            # Delete employees first (FK)
            employees = Employee.query.filter(Employee.full_name.like("Test Employee%")).all()
            for e in employees:
                db.session.delete(e)
            
            # Delete sites
            sites = Site.query.filter(Site.site_name.like("Test Site%")).all()
            for s in sites:
                db.session.delete(s)
                
            # Delete users
            users = User.query.filter(User.email.like("test_%@example.com")).all()
            for u in users:
                db.session.delete(u)
                
            db.session.commit()
        except:
            db.session.rollback()
        
        self.app_context.pop()

    def test_site_crud(self):
        # 1. Create
        response = self.client.post('/api/sites', json={
            'site_name': self.test_site_name,
            'site_code': 'TS01'
        })
        self.assertEqual(response.status_code, 201)
        data = response.get_json()['data']
        site_id = data['id']
        self.assertEqual(data['site_name'], self.test_site_name)
        
        # 2. Get
        response = self.client.get(f'/api/sites/{site_id}')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['data']['id'], site_id)
        
        # 3. Update
        new_name = f"{self.test_site_name} Updated"
        response = self.client.put(f'/api/sites/{site_id}', json={
            'site_name': new_name
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['data']['site_name'], new_name)
        
        # 4. List (check if our site is there)
        response = self.client.get('/api/sites')
        self.assertEqual(response.status_code, 200)
        sites = response.get_json()['data']
        found = any(s['id'] == site_id for s in sites)
        self.assertTrue(found)
        
        # 5. Delete
        response = self.client.delete(f'/api/sites/{site_id}')
        self.assertEqual(response.status_code, 200)
        
        # Verify deletion
        response = self.client.get(f'/api/sites/{site_id}')
        self.assertEqual(response.status_code, 404)

    def test_employee_crud(self):
        # Create a site first
        site_res = self.client.post('/api/sites', json={
            'site_name': self.test_site_name,
            'site_code': 'TS02'
        })
        site_id = site_res.get_json()['data']['id']
        
        # 1. Create Employee
        emp_name = "Test Employee 1"
        response = self.client.post('/api/employees', json={
            'site_id': site_id,
            'full_name': emp_name,
            'passport_id': 'AB123456'
        })
        self.assertEqual(response.status_code, 201)
        data = response.get_json()['data']
        emp_id = data['id']
        self.assertEqual(data['full_name'], emp_name)
        self.assertEqual(data['site_id'], site_id)
        
        # 2. Get
        response = self.client.get(f'/api/employees/{emp_id}')
        self.assertEqual(response.status_code, 200)
        
        # 3. Update
        response = self.client.put(f'/api/employees/{emp_id}', json={
            'full_name': "Test Employee Updated"
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['data']['full_name'], "Test Employee Updated")
        
        # 4. List by Site
        response = self.client.get(f'/api/employees?site_id={site_id}')
        self.assertEqual(response.status_code, 200)
        emps = response.get_json()['data']
        self.assertTrue(len(emps) >= 1)
        self.assertEqual(emps[0]['id'], emp_id)
        
        # 5. Delete
        response = self.client.delete(f'/api/employees/{emp_id}')
        self.assertEqual(response.status_code, 200)

    def test_user_crud(self):
        # 1. Create
        response = self.client.post('/api/users', json={
            'full_name': 'Test User',
            'email': self.test_user_email,
            'role': 'ADMIN',
            'password': 'password123'
        })
        self.assertEqual(response.status_code, 201)
        data = response.get_json()['data']
        user_id = data['id']
        self.assertEqual(data['email'], self.test_user_email)
        self.assertNotIn('password', data)
        self.assertNotIn('password_hash', data)
        
        # 2. Get
        response = self.client.get(f'/api/users/{user_id}')
        self.assertEqual(response.status_code, 200)
        
        # 3. Update
        response = self.client.put(f'/api/users/{user_id}', json={
            'phone_number': '1234567890'
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['data']['phone_number'], '1234567890')
        
        # 4. Delete
        response = self.client.delete(f'/api/users/{user_id}')
        self.assertEqual(response.status_code, 200)
        
        # Verify deletion
        response = self.client.get(f'/api/users/{user_id}')
        self.assertEqual(response.status_code, 404)

    
    def test_work_card_flow(self):
        # Create site
        site_res = self.client.post('/api/sites', json={
            'site_name': f"{self.test_site_name} WC",
            'site_code': 'WC01'
        })
        site_id = site_res.get_json()['data']['id']
        
        # Create user for approval
        user_res = self.client.post('/api/users', json={
            'full_name': 'Approver',
            'email': f"approver_{uuid.uuid4()}@example.com",
            'role': 'ADMIN',
            'password': 'password'
        })
        user_id = user_res.get_json()['data']['id']

        # Manual DB insertion for work card (since we don't have create API for it yet - comes from upload)
        from backend.app.models.work_cards import WorkCard
        from datetime import date
        
        with self.app.app_context():
            wc = WorkCard(
                site_id=site_id,
                processing_month=date(2025, 1, 1),
                review_status='NEEDS_REVIEW',
                source='MANUAL',
                original_filename='test.jpg',
                mime_type='image/jpeg',
                file_size_bytes=100
            )
            db.session.add(wc)
            db.session.commit()
            wc_id = str(wc.id)

        # 1. Get
        response = self.client.get(f'/api/work_cards/{wc_id}')
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['data']['review_status'], 'NEEDS_REVIEW')
        
        # 2. Update Status
        response = self.client.put(f'/api/work_cards/{wc_id}/status', json={
            'status': 'NEEDS_ASSIGNMENT'
        })
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['data']['review_status'], 'NEEDS_ASSIGNMENT')
        
        # 3. Approve
        response = self.client.post(f'/api/work_cards/{wc_id}/approve', json={
            'user_id': user_id
        })
        self.assertEqual(response.status_code, 200)
        data = response.get_json()['data']
        self.assertEqual(data['review_status'], 'APPROVED')
        self.assertEqual(data['approved_by_user_id'], user_id)
        
        # Cleanup
        with self.app.app_context():
            WorkCard.query.filter_by(id=wc_id).delete()
            db.session.commit()

    def test_work_card_assignment_transitions_to_needs_review(self):
        # Create site
        site_res = self.client.post('/api/sites', json={
            'site_name': f"{self.test_site_name} Assign",
            'site_code': 'WCAS'
        })
        site_id = site_res.get_json()['data']['id']

        # Create employee to assign
        employee_res = self.client.post('/api/employees', json={
            'full_name': 'Assignment Target',
            'passport_id': f'P-{uuid.uuid4().hex[:8]}',
            'site_id': site_id
        })
        employee_id = employee_res.get_json()['data']['id']

        from backend.app.models.work_cards import WorkCard
        from datetime import date

        with self.app.app_context():
            wc = WorkCard(
                site_id=site_id,
                processing_month=date(2025, 1, 1),
                employee_id=None,
                review_status='NEEDS_ASSIGNMENT',
                source='MANUAL',
                original_filename='assign.jpg',
                mime_type='image/jpeg',
                file_size_bytes=100
            )
            db.session.add(wc)
            db.session.commit()
            wc_id = str(wc.id)

        response = self.client.put(f'/api/work_cards/{wc_id}', json={
            'employee_id': employee_id
        })
        self.assertEqual(response.status_code, 200)
        data = response.get_json()['data']
        self.assertEqual(data['employee_id'], employee_id)
        self.assertEqual(data['review_status'], 'NEEDS_REVIEW')

        with self.app.app_context():
            WorkCard.query.filter_by(id=wc_id).delete()
            db.session.commit()

if __name__ == '__main__':
    unittest.main()
