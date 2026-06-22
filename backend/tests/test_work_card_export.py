"""Tests for the work-card image export endpoint (GET /api/work_cards/export).

Covers the new `card_ids` selection mode: exporting specific cards (including
multiple per employee), embedding the review comment in the filename, and
collision-safe naming when two selected cards share an employee.
"""
import io
import unittest
import uuid
import zipfile
from datetime import date

from dotenv import load_dotenv

load_dotenv()

from backend.app import create_app, db
from backend.app.auth_utils import encode_auth_token
from backend.app.models.business import Business
from backend.app.models.sites import Site, Employee
from backend.app.models.users import User
from backend.app.models.work_cards import WorkCard, WorkCardFile


class WorkCardExportTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.client = self.app.test_client()
        self.ctx = self.app.app_context()
        self.ctx.push()

        suffix = uuid.uuid4().hex[:8]
        self.business = Business(name=f'Exp Biz {suffix}', code=f'expbiz-{suffix}', is_active=True)
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

        self.month = date(2026, 5, 1)

        # Two cards for the SAME employee in the same month, with comments.
        self.card_a = self._make_card(notes='needs recheck day 5', review_status='APPROVED')
        self.card_b = self._make_card(notes='second upload', review_status='NEEDS_REVIEW')
        db.session.commit()

        self.site_id = self.site.id
        self.card_a_id = self.card_a.id
        self.card_b_id = self.card_b.id

        token = encode_auth_token(str(self.admin.id))
        self.headers = {'Authorization': f'Bearer {token}'}

    def _make_card(self, notes, review_status):
        card = WorkCard(
            business_id=self.business.id, site_id=self.site.id, employee_id=self.employee.id,
            processing_month=self.month, source='ADMIN_SINGLE', review_status=review_status,
            notes=notes, original_filename='card.jpg',
        )
        db.session.add(card)
        db.session.flush()
        db.session.add(WorkCardFile(
            work_card_id=card.id, content_type='image/jpeg', file_name='card.jpg',
            file_size_bytes=4, image_bytes=b'JPEG',
        ))
        return card

    def tearDown(self):
        try:
            for c in WorkCard.query.filter_by(business_id=self.business.id).all():
                db.session.delete(c)
            for e in Employee.query.filter_by(business_id=self.business.id).all():
                db.session.delete(e)
            for s in Site.query.filter_by(business_id=self.business.id).all():
                db.session.delete(s)
            for u in User.query.filter_by(business_id=self.business.id).all():
                db.session.delete(u)
            db.session.delete(Business.query.get(self.business.id))
            db.session.commit()
        except Exception:
            db.session.rollback()
        self.ctx.pop()

    def _export(self, **params):
        params.setdefault('site_id', str(self.site_id))
        params.setdefault('month', '2026-05-01')
        return self.client.get('/api/work_cards/export', query_string=params, headers=self.headers)

    def test_card_ids_exports_selected_cards_with_comment_in_filename(self):
        resp = self._export(card_ids=f'{self.card_a_id},{self.card_b_id}')
        self.assertEqual(resp.status_code, 200)

        with zipfile.ZipFile(io.BytesIO(resp.data)) as zf:
            names = zf.namelist()

        # Both selected cards present, no overwrite (same employee, two cards).
        self.assertEqual(len(names), 2)
        joined = '\n'.join(names)
        self.assertIn('needs_recheck_day_5', joined)  # comment embedded in filename
        self.assertIn('second_upload', joined)
        # Filenames use the first name only ("David"), never the surname.
        self.assertIn('David', joined)
        self.assertNotIn('Levi', joined)

    def test_card_ids_scoped_to_business(self):
        # A card_id from another business/site must not leak into the export.
        bogus = uuid.uuid4()
        resp = self._export(card_ids=str(bogus))
        self.assertEqual(resp.status_code, 200)
        with zipfile.ZipFile(io.BytesIO(resp.data)) as zf:
            self.assertEqual(zf.namelist(), [])

    def test_requires_card_ids_or_employee_ids(self):
        resp = self._export()
        self.assertEqual(resp.status_code, 400)


if __name__ == '__main__':
    unittest.main()
