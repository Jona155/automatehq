"""Role scoping for /api/missing-cards.

A FIELD_MANAGER may read the page, but only for the sites they own, and may not
trigger any WhatsApp delivery. Mirrors test_analytics_api.py's fixture style.
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

MONTH = date(2026, 6, 1)
MONTH_PARAM = '2026-06'


class MissingCardsScopingTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.ctx = self.app.app_context()
        self.ctx.push()
        self.client = self.app.test_client()

        suffix = uuid.uuid4().hex[:8]
        self.business = Business(name=f'Biz {suffix}', code=f'biz{suffix}', is_active=True)
        db.session.add(self.business)
        db.session.flush()

        self.admin = User(business_id=self.business.id, full_name='Admin',
                          email=f'admin_{suffix}@ex.com', role='ADMIN')
        self.fm = User(business_id=self.business.id, full_name='Field Mgr',
                       email=f'fm_{suffix}@ex.com', role='FIELD_MANAGER',
                       phone_number=f'05{suffix[:8]}')
        # Second field manager, deliberately with no sites assigned.
        self.fm_no_sites = User(business_id=self.business.id, full_name='Siteless Mgr',
                                email=f'fm2_{suffix}@ex.com', role='FIELD_MANAGER')
        db.session.add_all([self.admin, self.fm, self.fm_no_sites])
        db.session.flush()

        self.site_a = Site(business_id=self.business.id, site_name=f'SiteA {suffix}',
                           site_code='A1', is_active=True, field_manager_id=self.fm.id)
        self.site_b = Site(business_id=self.business.id, site_name=f'SiteB {suffix}',
                           site_code='B1', is_active=True)
        db.session.add_all([self.site_a, self.site_b])
        db.session.flush()

        # No work cards at all -> every employee is a gap.
        self.emp_a = Employee(business_id=self.business.id, site_id=self.site_a.id,
                              full_name='Emp A', passport_id=f'PA{suffix}', is_active=True)
        self.emp_b = Employee(business_id=self.business.id, site_id=self.site_b.id,
                              full_name='Emp B', passport_id=f'PB{suffix}', is_active=True)
        db.session.add_all([self.emp_a, self.emp_b])
        db.session.commit()

        self.admin_headers = {'Authorization': f'Bearer {encode_auth_token(str(self.admin.id))}'}
        self.fm_headers = {'Authorization': f'Bearer {encode_auth_token(str(self.fm.id))}'}
        self.fm_no_sites_headers = {
            'Authorization': f'Bearer {encode_auth_token(str(self.fm_no_sites.id))}'
        }

    def tearDown(self):
        try:
            biz_id = self.business.id
            WorkCard.query.filter_by(business_id=biz_id).delete(synchronize_session=False)
            Employee.query.filter_by(business_id=biz_id).delete(synchronize_session=False)
            Site.query.filter_by(business_id=biz_id).delete(synchronize_session=False)
            User.query.filter_by(business_id=biz_id).delete(synchronize_session=False)
            Business.query.filter_by(id=biz_id).delete(synchronize_session=False)
            db.session.commit()
        except Exception:
            db.session.rollback()
        finally:
            self.ctx.pop()

    def _get(self, headers, group_by='site'):
        return self.client.get(
            f'/api/missing-cards?month={MONTH_PARAM}&group_by={group_by}', headers=headers
        )

    # ---- read scoping ---------------------------------------------------
    def test_field_manager_can_read_own_sites_only(self):
        resp = self._get(self.fm_headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()['data']
        site_ids = {g['site_id'] for g in data['groups']}
        self.assertIn(str(self.site_a.id), site_ids)
        self.assertNotIn(str(self.site_b.id), site_ids)
        self.assertEqual(data['summary']['total_employees'], 1)

    def test_admin_sees_all_sites(self):
        resp = self._get(self.admin_headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()['data']
        site_ids = {g['site_id'] for g in data['groups']}
        self.assertEqual(site_ids, {str(self.site_a.id), str(self.site_b.id)})
        self.assertEqual(data['summary']['total_employees'], 2)

    def test_field_manager_without_sites_sees_nothing(self):
        """Empty site scope must not widen to the whole business."""
        resp = self._get(self.fm_no_sites_headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()['data']
        self.assertEqual(data['groups'], [])
        self.assertEqual(data['summary']['total_employees'], 0)

    def test_manager_pivot_scoped_for_field_manager(self):
        resp = self._get(self.fm_headers, group_by='field_manager')
        self.assertEqual(resp.status_code, 200)
        groups = resp.get_json()['data']['groups']
        self.assertEqual([g['field_manager_id'] for g in groups], [str(self.fm.id)])

    # ---- exports --------------------------------------------------------
    def test_field_manager_export_is_scoped(self):
        resp = self.client.get(f'/api/missing-cards/export?month={MONTH_PARAM}',
                               headers=self.fm_headers)
        self.assertEqual(resp.status_code, 200)
        self.assertIn('spreadsheet', resp.headers['Content-Type'])

    def test_field_manager_own_manager_export_ok(self):
        resp = self.client.get(
            f'/api/missing-cards/managers/{self.fm.id}/export?month={MONTH_PARAM}',
            headers=self.fm_headers,
        )
        self.assertEqual(resp.status_code, 200)

    def test_field_manager_cannot_export_other_manager(self):
        resp = self.client.get(
            f'/api/missing-cards/managers/{self.fm_no_sites.id}/export?month={MONTH_PARAM}',
            headers=self.fm_headers,
        )
        self.assertEqual(resp.status_code, 404)

    # ---- writes stay admin-only -----------------------------------------
    def test_field_manager_cannot_send_whatsapp(self):
        resp = self.client.post(
            f'/api/missing-cards/managers/{self.fm.id}/whatsapp',
            json={'processing_month': MONTH_PARAM},
            headers=self.fm_headers,
        )
        self.assertEqual(resp.status_code, 403)

    def test_field_manager_cannot_broadcast(self):
        resp = self.client.post(
            '/api/missing-cards/whatsapp/broadcast',
            json={'processing_month': MONTH_PARAM},
            headers=self.fm_headers,
        )
        self.assertEqual(resp.status_code, 403)

    def test_requires_auth(self):
        self.assertEqual(self.client.get('/api/missing-cards').status_code, 401)


if __name__ == '__main__':
    unittest.main()
