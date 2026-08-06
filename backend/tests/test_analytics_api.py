import unittest
import uuid
from datetime import date

from dotenv import load_dotenv

load_dotenv()

from backend.app import create_app, db
from backend.app.auth_utils import encode_auth_token
from backend.app.constants import BAND_LOW, BAND_HIGH
from backend.app.models.business import Business
from backend.app.models.sites import Site, Employee
from backend.app.models.users import User
from backend.app.models.work_cards import WorkCard, WorkCardDayEntry
from backend.app.services.analytics_service import resolve_period

# The endpoints default to the previous complete month; seed cards there so the
# no-param request lines up regardless of when the suite runs.
PREV_MONTH = resolve_period('prev_month')[0]


class ResolvePeriodTests(unittest.TestCase):
    """Pure period resolution — no DB (T5)."""

    def test_prev_month_default(self):
        self.assertEqual(resolve_period(None, date(2026, 7, 15)), [date(2026, 6, 1)])
        self.assertEqual(resolve_period('prev_month', date(2026, 7, 15)), [date(2026, 6, 1)])

    def test_last_3_months(self):
        self.assertEqual(
            resolve_period('last_3_months', date(2026, 7, 15)),
            [date(2026, 4, 1), date(2026, 5, 1), date(2026, 6, 1)],
        )

    def test_last_6_months_crosses_year_and_excludes_current(self):
        months = resolve_period('last_6_months', date(2026, 2, 10))
        self.assertEqual(months[-1], date(2026, 1, 1))   # last complete month
        self.assertEqual(months[0], date(2025, 8, 1))
        self.assertNotIn(date(2026, 2, 1), months)        # current month never included

    def test_unknown_period_falls_back_to_prev(self):
        self.assertEqual(resolve_period('garbage', date(2026, 7, 15)), [date(2026, 6, 1)])


class AnalyticsApiTests(unittest.TestCase):
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
                       email=f'fm_{suffix}@ex.com', role='FIELD_MANAGER')
        db.session.add_all([self.admin, self.fm])
        db.session.flush()

        # Site A owned by the field manager; Site B not owned.
        self.site_a = Site(business_id=self.business.id, site_name=f'SiteA {suffix}',
                           site_code='A1', is_active=True, field_manager_id=self.fm.id)
        self.site_b = Site(business_id=self.business.id, site_name=f'SiteB {suffix}',
                           site_code='B1', is_active=True)
        db.session.add_all([self.site_a, self.site_b])
        db.session.flush()

        # emp_a: single-site (A), 236h -> 100%.
        # emp_split: managed at A, days split A/B -> 236h total, multi-site.
        # emp_zero: home A, no card -> 0h.
        # emp_b: home B, 118h -> 50%.
        # emp_split intentionally has no serial number (the import column is
        # optional), so the payloads are covered for the null case too.
        self.emp_a = Employee(business_id=self.business.id, site_id=self.site_a.id,
                              full_name='Emp A', passport_id=f'PA{suffix}', is_active=True,
                              external_employee_id='SN-A')
        self.emp_split = Employee(business_id=self.business.id, site_id=self.site_a.id,
                                  full_name='Emp Split', passport_id=f'PS{suffix}', is_active=True)
        self.emp_zero = Employee(business_id=self.business.id, site_id=self.site_a.id,
                                 full_name='Emp Zero', passport_id=f'PZ{suffix}', is_active=True,
                                 external_employee_id='SN-Z')
        self.emp_b = Employee(business_id=self.business.id, site_id=self.site_b.id,
                              full_name='Emp B', passport_id=f'PB{suffix}', is_active=True,
                              external_employee_id='SN-B')
        db.session.add_all([self.emp_a, self.emp_split, self.emp_zero, self.emp_b])
        db.session.flush()

        self._card_with_days(self.emp_a, self.site_a, [(1, 118, None), (2, 118, None)])
        self._card_with_days(self.emp_split, self.site_a, [(1, 118, None), (2, 118, self.site_b)])
        self._card_with_days(self.emp_b, self.site_b, [(1, 118, None)])
        db.session.commit()

        self.admin_headers = {'Authorization': f'Bearer {encode_auth_token(str(self.admin.id))}'}
        self.fm_headers = {'Authorization': f'Bearer {encode_auth_token(str(self.fm.id))}'}

    def _card_with_days(self, employee, site, days):
        card = WorkCard(business_id=self.business.id, site_id=site.id, employee_id=employee.id,
                        processing_month=PREV_MONTH, source='EXTRACTED', review_status='APPROVED')
        db.session.add(card)
        db.session.flush()
        for day, hours, attr_site in days:
            db.session.add(WorkCardDayEntry(
                work_card_id=card.id, day_of_month=day, total_hours=hours,
                attributed_site_id=(attr_site.id if attr_site else None),
                source='EXTRACTED', is_valid=True))

    def tearDown(self):
        try:
            biz_id = self.business.id
            card_ids = [c.id for c in WorkCard.query.filter_by(business_id=biz_id).all()]
            if card_ids:
                WorkCardDayEntry.query.filter(WorkCardDayEntry.work_card_id.in_(card_ids)).delete(synchronize_session=False)
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

    # ---- scorecard scoping ---------------------------------------------
    def test_field_manager_scorecard_only_own_sites(self):
        resp = self.client.get('/api/analytics/site-scorecard', headers=self.fm_headers)
        self.assertEqual(resp.status_code, 200)
        sites = resp.get_json()['data']['sites']
        site_ids = {s['site_id'] for s in sites}
        self.assertIn(str(self.site_a.id), site_ids)          # positive
        self.assertNotIn(str(self.site_b.id), site_ids)       # negative
        self.assertEqual(len(sites), 1)

    def test_admin_scorecard_all_sites_sorted_worst_first(self):
        resp = self.client.get('/api/analytics/site-scorecard', headers=self.admin_headers)
        self.assertEqual(resp.status_code, 200)
        sites = resp.get_json()['data']['sites']
        self.assertEqual({s['site_id'] for s in sites}, {str(self.site_a.id), str(self.site_b.id)})
        # Site A avg (100,100,0)=66.7 < Site B avg (100,50)=75 -> A first.
        self.assertEqual(sites[0]['site_id'], str(self.site_a.id))
        self.assertLessEqual(sites[0]['avg_utilization'], sites[1]['avg_utilization'])

    def test_scorecard_low_performer_and_distribution(self):
        resp = self.client.get('/api/analytics/site-scorecard', headers=self.fm_headers)
        card_a = resp.get_json()['data']['sites'][0]
        self.assertEqual(card_a['employee_count'], 3)         # incl. zero-hour employee
        self.assertEqual(card_a['low_performer_count'], 1)    # emp_zero
        self.assertEqual(card_a['band_distribution'][BAND_HIGH], 2)
        self.assertEqual(card_a['band_distribution'][BAND_LOW], 1)

    # ---- detail authorization ------------------------------------------
    def test_field_manager_detail_own_site_ok(self):
        resp = self.client.get(f'/api/analytics/sites/{self.site_a.id}', headers=self.fm_headers)
        self.assertEqual(resp.status_code, 200)

    def test_field_manager_detail_foreign_site_404(self):
        resp = self.client.get(f'/api/analytics/sites/{self.site_b.id}', headers=self.fm_headers)
        self.assertEqual(resp.status_code, 404)

    def test_admin_detail_foreign_business_site_404(self):
        resp = self.client.get(f'/api/analytics/sites/{uuid.uuid4()}', headers=self.admin_headers)
        self.assertEqual(resp.status_code, 404)

    # ---- detail payload ------------------------------------------------
    def test_detail_leaderboard_shape_and_order(self):
        resp = self.client.get(f'/api/analytics/sites/{self.site_a.id}', headers=self.admin_headers)
        data = resp.get_json()['data']
        emps = data['employees']
        self.assertEqual(len(emps), 3)
        # worst-first: emp_zero (0%) leads.
        self.assertEqual(emps[0]['full_name'], 'Emp Zero')
        self.assertEqual(emps[0]['band'], BAND_LOW)
        self.assertEqual(emps[0]['utilization_pct'], 0.0)
        for e in emps:
            self.assertIn('delta_vs_site_avg', e)
            self.assertIn('is_multi_site', e)
            self.assertIn('sites_worked', e)

    def test_detail_multi_site_employee_flagged(self):
        resp = self.client.get(f'/api/analytics/sites/{self.site_a.id}', headers=self.admin_headers)
        emps = resp.get_json()['data']['employees']
        split = next(e for e in emps if e['full_name'] == 'Emp Split')
        self.assertTrue(split['is_multi_site'])
        worked_site_ids = {s['site_id'] for s in split['sites_worked']}
        self.assertEqual(worked_site_ids, {str(self.site_a.id), str(self.site_b.id)})
        self.assertEqual(split['hours_at_site'], 118.0)       # only site A's share
        self.assertEqual(split['total_hours'], 236.0)

    # ---- serial number (מספר סידורי) -----------------------------------
    def test_detail_leaderboard_exposes_serial_number(self):
        """The UI labels rows with first name only, so it needs the serial to
        disambiguate same-first-name workers."""
        resp = self.client.get(f'/api/analytics/sites/{self.site_a.id}', headers=self.admin_headers)
        emps = {e['full_name']: e for e in resp.get_json()['data']['employees']}
        self.assertEqual(emps['Emp A']['external_employee_id'], 'SN-A')
        self.assertEqual(emps['Emp Zero']['external_employee_id'], 'SN-Z')
        self.assertIsNone(emps['Emp Split']['external_employee_id'])

    def test_employee_detail_exposes_serial_number(self):
        resp = self.client.get(f'/api/analytics/sites/{self.site_a.id}/employees/{self.emp_a.id}',
                               headers=self.admin_headers)
        self.assertEqual(resp.get_json()['data']['external_employee_id'], 'SN-A')

    def test_employee_detail_serial_number_null_when_unset(self):
        resp = self.client.get(f'/api/analytics/sites/{self.site_a.id}/employees/{self.emp_split.id}',
                               headers=self.admin_headers)
        self.assertIsNone(resp.get_json()['data']['external_employee_id'])

    # ---- period --------------------------------------------------------
    def test_period_param_shapes_month_list(self):
        resp1 = self.client.get('/api/analytics/site-scorecard', headers=self.admin_headers)
        self.assertEqual(len(resp1.get_json()['data']['months']), 1)
        resp3 = self.client.get('/api/analytics/site-scorecard?period=last_3_months', headers=self.admin_headers)
        self.assertEqual(len(resp3.get_json()['data']['months']), 3)

    # ---- headline summary tiles (scoped) -------------------------------
    def test_scorecard_summary_scoped_to_visible_sites(self):
        resp = self.client.get('/api/analytics/site-scorecard', headers=self.fm_headers)
        s = resp.get_json()['data']['summary']
        for k in ('total_sites', 'sites_meeting_criteria', 'total_employees',
                  'employees_below_average', 'employees_above_average', 'overall_avg_utilization'):
            self.assertIn(k, s)
        self.assertEqual(s['total_sites'], 1)                       # FM owns only site_a here
        self.assertLessEqual(s['sites_meeting_criteria'], s['total_sites'])
        # below + above covers everyone (above uses >= avg)
        self.assertEqual(s['employees_below_average'] + s['employees_above_average'], s['total_employees'])

    def test_detail_has_hours_delta(self):
        resp = self.client.get(f'/api/analytics/sites/{self.site_a.id}', headers=self.admin_headers)
        d = resp.get_json()['data']
        self.assertIsNotNone(d['site_health']['avg_hours'])
        for e in d['employees']:
            self.assertIn('delta_hours_vs_site_avg', e)

    # ---- trends (T17) --------------------------------------------------
    def test_scorecard_trend_length_matches_period(self):
        r1 = self.client.get('/api/analytics/site-scorecard', headers=self.fm_headers)
        for s in r1.get_json()['data']['sites']:
            self.assertEqual(len(s['trend']), 1)
            self.assertEqual(set(s['trend'][0]), {'month', 'utilization'})
        r3 = self.client.get('/api/analytics/site-scorecard?period=last_3_months', headers=self.fm_headers)
        for s in r3.get_json()['data']['sites']:
            self.assertEqual(len(s['trend']), 3)

    def test_detail_trend_present(self):
        resp = self.client.get(f'/api/analytics/sites/{self.site_a.id}?period=last_3_months', headers=self.admin_headers)
        d = resp.get_json()['data']
        self.assertEqual(len(d['site_health']['trend']), 3)
        for e in d['employees']:
            self.assertEqual(len(e['trend']), 3)

    # ---- employee detail (T18) -----------------------------------------
    def test_employee_detail_shape(self):
        resp = self.client.get(f'/api/analytics/sites/{self.site_a.id}/employees/{self.emp_a.id}', headers=self.fm_headers)
        self.assertEqual(resp.status_code, 200)
        d = resp.get_json()['data']
        for key in ('utilization_pct', 'band', 'site_avg_utilization', 'company_avg_utilization', 'trend', 'sites_worked', 'total_hours'):
            self.assertIn(key, d)
        self.assertEqual(d['employee_id'], str(self.emp_a.id))

    def test_employee_detail_foreign_site_404(self):
        # site_b is not owned by the field manager
        resp = self.client.get(f'/api/analytics/sites/{self.site_b.id}/employees/{self.emp_b.id}', headers=self.fm_headers)
        self.assertEqual(resp.status_code, 404)

    def test_employee_detail_non_member_404(self):
        # emp_b is a member of site_b, not site_a
        resp = self.client.get(f'/api/analytics/sites/{self.site_a.id}/employees/{self.emp_b.id}', headers=self.admin_headers)
        self.assertEqual(resp.status_code, 404)

    # ---- auth ----------------------------------------------------------
    def test_requires_auth(self):
        self.assertEqual(self.client.get('/api/analytics/site-scorecard').status_code, 401)


if __name__ == '__main__':
    unittest.main()
