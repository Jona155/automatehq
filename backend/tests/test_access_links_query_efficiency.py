import os
import uuid
import unittest
from datetime import date
from unittest.mock import patch

from dotenv import load_dotenv
from sqlalchemy import event

load_dotenv()

from backend.app import create_app, db
from backend.app.auth_utils import encode_auth_token
from backend.app.models.business import Business
from backend.app.models.sites import Employee, Site
from backend.app.models.upload_access import UploadAccessRequest
from backend.app.models.users import User


class _FakeTwilioMessages:
    def create(self, **kwargs):
        return type('Message', (), {'sid': 'SM_TEST'})()


class _FakeTwilioClient:
    def __init__(self, *args, **kwargs):
        self.messages = _FakeTwilioMessages()


class AccessLinkQueryEfficiencyTests(unittest.TestCase):
    def setUp(self):
        os.environ.setdefault('JWT_SECRET_KEY', 'test-secret')
        os.environ['TWILIO_ACCOUNT_SID'] = 'sid'
        os.environ['TWILIO_AUTH_TOKEN'] = 'token'
        os.environ['TWILIO_WHATSAPP_NUMBER'] = 'whatsapp:+123456789'

        self.app = create_app()
        self.client = self.app.test_client()
        self.app_context = self.app.app_context()
        self.app_context.push()

        suffix = str(uuid.uuid4())[:8]
        self.business = Business(name=f'Query Biz {suffix}', code=f'qb-{suffix}', is_active=True)
        db.session.add(self.business)
        db.session.flush()

        self.user = User(
            business_id=self.business.id,
            full_name='Query Tester',
            email=f'query-{suffix}@example.com',
            role='ADMIN',
            password_hash='x',
            is_active=True,
        )
        db.session.add(self.user)

        self.site = Site(
            business_id=self.business.id,
            site_name=f'Query Site {suffix}',
            site_code=f'QS{suffix}',
            is_active=True,
        )
        db.session.add(self.site)
        db.session.flush()

        self.employee = Employee(
            business_id=self.business.id,
            site_id=self.site.id,
            full_name='Responsible Employee',
            phone_number='0501234567',
            is_active=True,
        )
        db.session.add(self.employee)
        db.session.flush()

        self.site.responsible_employee_id = self.employee.id

        for idx in range(5):
            req = UploadAccessRequest(
                token=f'token-{suffix}-{idx}',
                business_id=self.business.id,
                site_id=self.site.id,
                employee_id=self.employee.id,
                processing_month=date(2026, 1, 1),
                created_by_user_id=self.user.id,
                is_active=True,
            )
            db.session.add(req)

        self.batch_sites = []
        for idx in range(5):
            site = Site(
                business_id=self.business.id,
                site_name=f'Batch Site {suffix}-{idx}',
                site_code=f'B{idx}{suffix}',
                is_active=True,
            )
            db.session.add(site)
            db.session.flush()
            employee = Employee(
                business_id=self.business.id,
                site_id=site.id,
                full_name=f'Batch Employee {idx}',
                phone_number='0501234567',
                is_active=True,
            )
            db.session.add(employee)
            db.session.flush()
            site.responsible_employee_id = employee.id
            self.batch_sites.append(site)

        db.session.commit()

        token = encode_auth_token(self.user.id)
        self.auth_headers = {'Authorization': f'Bearer {token}'}

    def tearDown(self):
        db.session.rollback()
        db.session.query(UploadAccessRequest).filter_by(business_id=self.business.id).delete(synchronize_session=False)
        db.session.query(Employee).filter_by(business_id=self.business.id).delete(synchronize_session=False)
        db.session.query(Site).filter_by(business_id=self.business.id).delete(synchronize_session=False)
        db.session.query(User).filter_by(id=self.user.id).delete(synchronize_session=False)
        db.session.query(Business).filter_by(id=self.business.id).delete(synchronize_session=False)
        db.session.commit()
        self.app_context.pop()

    def _count_selects(self, func):
        select_count = 0

        def before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
            nonlocal select_count
            if statement.lstrip().upper().startswith('SELECT'):
                select_count += 1

        event.listen(db.engine, 'before_cursor_execute', before_cursor_execute)
        try:
            response = func()
        finally:
            event.remove(db.engine, 'before_cursor_execute', before_cursor_execute)
        return response, select_count

    def test_list_access_links_query_count_is_constant(self):
        response, select_count = self._count_selects(
            lambda: self.client.get(f'/api/sites/{self.site.id}/access-links', headers=self.auth_headers)
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(len(response.get_json()['data']), 5)
        self.assertLessEqual(select_count, 5)

    def test_send_whatsapp_batch_prefetch_query_counts_for_small_and_large_payloads(self):
        token_iter = iter([f'batch-token-{i}' for i in range(20)])

        def _call(site_count):
            payload = {
                'processing_month': '2026-01-01',
                'site_ids': [str(site.id) for site in self.batch_sites[:site_count]],
            }
            return self.client.post('/api/sites/access-links/whatsapp-batch', json=payload, headers=self.auth_headers)

        with patch('backend.app.api.sites.Client', _FakeTwilioClient), patch(
            'backend.app.api.sites._generate_access_token', side_effect=lambda: next(token_iter)
        ):
            small_response, small_selects = self._count_selects(lambda: _call(1))
            large_response, large_selects = self._count_selects(lambda: _call(5))

        self.assertEqual(small_response.status_code, 200)
        self.assertEqual(large_response.status_code, 200)
        self.assertEqual(small_response.get_json()['data']['sent_count'], 1)
        self.assertEqual(large_response.get_json()['data']['sent_count'], 5)

        self.assertLessEqual(small_selects, 6)
        self.assertLessEqual(large_selects, 6)


if __name__ == '__main__':
    unittest.main()
