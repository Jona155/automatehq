"""Round-trip tests for the per-day `comment` field on work-card day entries.

Verifies a comment saved via PUT /api/work_cards/<id>/day-entries is persisted
and returned by GET, that blank comments normalize to null, and that a comment
can accompany a day_status day.
"""
import unittest
import uuid
from datetime import date

from dotenv import load_dotenv

load_dotenv()

from backend.app import create_app, db
from backend.app.auth_utils import encode_auth_token
from backend.app.models.business import Business
from backend.app.models.sites import Site, Employee
from backend.app.models.users import User
from backend.app.models.work_cards import WorkCard
from backend.app.repositories.business_repository import BusinessRepository


class DayEntryCommentTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.client = self.app.test_client()
        self.ctx = self.app.app_context()
        self.ctx.push()

        suffix = uuid.uuid4().hex[:8]
        self.business = Business(name=f'Cmt Biz {suffix}', code=f'cmtbiz-{suffix}', is_active=True)
        db.session.add(self.business)
        db.session.flush()

        self.admin = User(
            full_name='Admin', email=f'admin_{suffix}@example.com',
            role='ADMIN', business_id=self.business.id, is_active=True,
        )
        db.session.add(self.admin)
        db.session.flush()

        self.site = Site(site_name=f'Site {suffix}', business_id=self.business.id, hourly_tariff=50)
        db.session.add(self.site)
        db.session.flush()

        self.employee = Employee(
            business_id=self.business.id, site_id=self.site.id,
            full_name='David Levi', passport_id=f'P{suffix}',
        )
        db.session.add(self.employee)
        db.session.flush()

        self.card = WorkCard(
            business_id=self.business.id, site_id=self.site.id, employee_id=self.employee.id,
            processing_month=date(2026, 5, 1), source='ADMIN_SINGLE', review_status='NEEDS_REVIEW',
            original_filename='card.jpg',
        )
        db.session.add(self.card)
        db.session.commit()
        self.card_id = self.card.id

        token = encode_auth_token(str(self.admin.id))
        self.headers = {'Authorization': f'Bearer {token}'}

    def tearDown(self):
        try:
            BusinessRepository().hard_delete(self.business.id)
        except Exception:
            db.session.rollback()
        self.ctx.pop()

    def _put(self, entries):
        return self.client.put(
            f'/api/work_cards/{self.card_id}/day-entries',
            json={'entries': entries},
            headers=self.headers,
        )

    def _get_entries(self):
        resp = self.client.get(
            f'/api/work_cards/{self.card_id}/day-entries',
            headers=self.headers,
        )
        self.assertEqual(resp.status_code, 200)
        return {e['day_of_month']: e for e in resp.get_json()['data']}

    def test_comment_round_trips(self):
        resp = self._put([
            {'day_of_month': 5, 'from_time': '08:00', 'to_time': '18:00', 'total_hours': 10,
             'comment': 'verify 10h?'},
        ])
        self.assertEqual(resp.status_code, 200)

        entries = self._get_entries()
        self.assertEqual(entries[5]['comment'], 'verify 10h?')

    def test_blank_comment_normalized_to_null(self):
        resp = self._put([
            {'day_of_month': 6, 'from_time': '08:00', 'to_time': '16:00', 'total_hours': 8,
             'comment': '   '},
        ])
        self.assertEqual(resp.status_code, 200)

        entries = self._get_entries()
        self.assertIsNone(entries[6]['comment'])

    def test_comment_persists_on_status_day(self):
        resp = self._put([
            {'day_of_month': 7, 'day_status': 'VACATION', 'comment': 'approved by manager'},
        ])
        self.assertEqual(resp.status_code, 200)

        entries = self._get_entries()
        self.assertEqual(entries[7]['day_status'], 'VACATION')
        self.assertEqual(entries[7]['comment'], 'approved by manager')


if __name__ == '__main__':
    unittest.main()
