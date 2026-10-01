"""Absences report: workday rules, day classification, card merging, settings,
exclusions and role scoping.

Requires a reachable local Postgres (same as the other DB-backed tests).
"""
import unittest
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal

from dotenv import load_dotenv

load_dotenv()

from backend.app import create_app, db
from backend.app.auth_utils import encode_auth_token
from backend.app.models.absences import (
    AbsenceEmployeeDaySettings, AbsenceEmployeeExclusion, AbsenceMonthSettings,
)
from backend.app.models.business import Business
from backend.app.models.sites import Site, Employee
from backend.app.models.users import User
from backend.app.models.work_cards import WorkCard, WorkCardDayEntry
from backend.app.services import absences_service as svc

# June 2026: the 1st is a Monday. Saturdays: 6, 13, 20, 27. 30 days.
MONTH = date(2026, 6, 1)
MONTH_PARAM = '2026-06'
AFTER_MONTH = date(2026, 7, 10)
SATURDAYS = {6, 13, 20, 27}
ALL_WORKDAYS = [d for d in range(1, 31) if d not in SATURDAYS]


class WorkdayRulesTests(unittest.TestCase):
    def test_saturdays_excluded(self):
        self.assertEqual(svc.compute_workdays(MONTH, [], AFTER_MONTH), ALL_WORKDAYS)

    def test_ignored_days_excluded(self):
        days = svc.compute_workdays(MONTH, [1, 2], AFTER_MONTH)
        self.assertNotIn(1, days)
        self.assertNotIn(2, days)
        self.assertEqual(len(days), len(ALL_WORKDAYS) - 2)

    def test_current_month_stops_at_today(self):
        self.assertEqual(svc.compute_workdays(MONTH, [], date(2026, 6, 8)), [1, 2, 3, 4, 5, 7, 8])

    def test_future_month_is_empty(self):
        self.assertEqual(svc.compute_workdays(MONTH, [], date(2026, 5, 20)), [])

    def test_normalize_ignored_days(self):
        self.assertEqual(svc.normalize_ignored_days(MONTH, [3, '1', 3]), [1, 3])
        for bad in ([31], [0], ['x'], [True], [1.5]):
            with self.assertRaises(ValueError):
                svc.normalize_ignored_days(MONTH, bad)


class AbsencesDBTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.ctx = self.app.app_context()
        self.ctx.push()
        self.client = self.app.test_client()

        suffix = uuid.uuid4().hex[:8]
        self.business = Business(name=f'Abs {suffix}', code=f'abs{suffix}', is_active=True)
        db.session.add(self.business)
        db.session.flush()

        self.admin = User(business_id=self.business.id, full_name='Admin',
                          email=f'abs_admin_{suffix}@ex.com', role='ADMIN')
        self.fm = User(business_id=self.business.id, full_name='FM',
                       email=f'abs_fm_{suffix}@ex.com', role='FIELD_MANAGER',
                       phone_number=f'05{suffix[:8]}')
        db.session.add_all([self.admin, self.fm])
        db.session.flush()

        self.site_a = Site(business_id=self.business.id, site_name=f'A {suffix}',
                           is_active=True, field_manager_id=self.fm.id)
        self.site_b = Site(business_id=self.business.id, site_name=f'B {suffix}', is_active=True)
        db.session.add_all([self.site_a, self.site_b])
        db.session.flush()
        db.session.commit()

        self.admin_headers = {'Authorization': f'Bearer {encode_auth_token(str(self.admin.id))}'}
        self.fm_headers = {'Authorization': f'Bearer {encode_auth_token(str(self.fm.id))}'}

    def tearDown(self):
        try:
            biz_id = self.business.id
            card_ids = [c.id for c in WorkCard.query.filter_by(business_id=biz_id)]
            if card_ids:
                WorkCardDayEntry.query.filter(WorkCardDayEntry.work_card_id.in_(card_ids)).delete(
                    synchronize_session=False)
            AbsenceEmployeeExclusion.query.filter_by(business_id=biz_id).delete(synchronize_session=False)
            AbsenceEmployeeDaySettings.query.filter_by(business_id=biz_id).delete(synchronize_session=False)
            AbsenceMonthSettings.query.filter_by(business_id=biz_id).delete(synchronize_session=False)
            WorkCard.query.filter_by(business_id=biz_id).delete(synchronize_session=False)
            Employee.query.filter_by(business_id=biz_id).delete(synchronize_session=False)
            Site.query.filter_by(business_id=biz_id).delete(synchronize_session=False)
            User.query.filter_by(business_id=biz_id).delete(synchronize_session=False)
            Business.query.filter_by(id=biz_id).delete(synchronize_session=False)
            db.session.commit()
        finally:
            db.session.remove()
            self.ctx.pop()

    # -- helpers ---------------------------------------------------------
    def _employee(self, name, site=None):
        emp = Employee(business_id=self.business.id, site_id=(site or self.site_a).id,
                       full_name=name, passport_id=f'P{uuid.uuid4().hex[:10]}', is_active=True)
        db.session.add(emp)
        db.session.flush()
        return emp

    def _card(self, emp, status='NEEDS_REVIEW', created=None, worked=(), sick=(), vacation=(), blank=()):
        card = WorkCard(business_id=self.business.id, site_id=emp.site_id, employee_id=emp.id,
                        processing_month=MONTH, source='ADMIN_SINGLE', review_status=status,
                        created_at=created or datetime(2026, 6, 15, tzinfo=timezone.utc))
        db.session.add(card)
        db.session.flush()
        for d in worked:
            db.session.add(WorkCardDayEntry(work_card_id=card.id, day_of_month=d, total_hours=Decimal('8')))
        for d in sick:
            db.session.add(WorkCardDayEntry(work_card_id=card.id, day_of_month=d, day_status='SICK'))
        for d in vacation:
            db.session.add(WorkCardDayEntry(work_card_id=card.id, day_of_month=d, day_status='VACATION'))
        for d in blank:
            db.session.add(WorkCardDayEntry(work_card_id=card.id, day_of_month=d))
        db.session.flush()
        return card

    def _full_month_except(self, *skip):
        return [d for d in ALL_WORKDAYS if d not in skip]

    def _rows(self, **kw):
        db.session.commit()
        return svc.compute_absences(self.business.id, MONTH, today=AFTER_MONTH, **kw)

    def _row(self, result, emp):
        return next((r for r in result['rows'] if r['employee_id'] == str(emp.id)), None)

    # -- classification --------------------------------------------------
    def test_sick_empty_and_non_counted_days(self):
        emp = self._employee('Worker')
        self._card(emp, worked=self._full_month_except(2, 3, 4, 5, 8),
                   sick=[2, 3], vacation=[4], blank=[5])
        row = self._row(self._rows(), emp)
        self.assertEqual(row['sick_days'], [2, 3])
        self.assertEqual(row['empty_days'], [5, 8])  # 5 blank row, 8 no row at all
        self.assertEqual(row['missed_total'], 4)
        self.assertEqual(row['card_status'], svc.CARD_PENDING)

    def test_saturday_blank_not_counted_and_ignored_days_respected(self):
        emp = self._employee('Worker')
        self._card(emp, worked=self._full_month_except(8))
        db.session.add(AbsenceMonthSettings(business_id=self.business.id, processing_month=MONTH,
                                            ignored_days=[8]))
        result = self._rows()
        self.assertIsNone(self._row(result, emp))
        self.assertEqual(result['settings']['ignored_days'], [8])

    def test_employee_ignored_days_apply_only_to_that_employee(self):
        late = self._employee('Started mid-month')
        other = self._employee('Other')
        # Started on the 10th: nothing reported before it.
        self._card(late, worked=[d for d in ALL_WORKDAYS if d >= 10 and d != 22])
        self._card(other, worked=[d for d in ALL_WORKDAYS if d >= 10])
        db.session.add(AbsenceEmployeeDaySettings(business_id=self.business.id, processing_month=MONTH,
                                                  employee_id=late.id, ignored_days=list(range(1, 10))))
        result = self._rows()
        late_row = self._row(result, late)
        self.assertEqual(late_row['empty_days'], [22])
        self.assertEqual(late_row['ignored_days'], list(range(1, 10)))
        self.assertEqual(self._row(result, other)['empty_days'], [d for d in ALL_WORKDAYS if d < 10])
        self.assertEqual([o['employee_id'] for o in result['employee_overrides']], [str(late.id)])

    def test_employee_override_listed_even_without_absences(self):
        emp = self._employee('Left early')
        self._card(emp, worked=[d for d in ALL_WORKDAYS if d <= 20])
        db.session.add(AbsenceEmployeeDaySettings(business_id=self.business.id, processing_month=MONTH,
                                                  employee_id=emp.id, ignored_days=list(range(21, 31))))
        result = self._rows()
        self.assertIsNone(self._row(result, emp))
        self.assertEqual(result['employee_overrides'][0]['ignored_days'], list(range(21, 31)))

    def test_employee_override_listed_without_card(self):
        emp = self._employee('Starts later')
        db.session.add(AbsenceEmployeeDaySettings(business_id=self.business.id, processing_month=MONTH,
                                                  employee_id=emp.id, ignored_days=[1, 2]))
        result = self._rows()
        self.assertEqual(result['rows'], [])
        self.assertEqual([o['employee_id'] for o in result['employee_overrides']], [str(emp.id)])

    def test_employee_overrides_scoped_for_field_manager(self):
        emp_b = self._employee('B', self.site_b)
        db.session.add(AbsenceEmployeeDaySettings(business_id=self.business.id, processing_month=MONTH,
                                                  employee_id=emp_b.id, ignored_days=[1]))
        db.session.commit()
        data = self.client.get(f'/api/absences?month={MONTH_PARAM}', headers=self.fm_headers).get_json()['data']
        self.assertEqual(data['employee_overrides'], [])

    def test_employee_without_cards_is_hidden(self):
        self._employee('No card')
        self.assertEqual(self._rows()['rows'], [])

    # -- merging ---------------------------------------------------------
    def test_two_half_month_cards_merge(self):
        emp = self._employee('Split')
        first_half = [d for d in ALL_WORKDAYS if d <= 15]
        second_half = [d for d in ALL_WORKDAYS if d > 15]
        self._card(emp, worked=first_half, created=datetime(2026, 6, 16, tzinfo=timezone.utc))
        self._card(emp, worked=[d for d in second_half if d != 22],
                   created=datetime(2026, 7, 1, tzinfo=timezone.utc))
        row = self._row(self._rows(), emp)
        self.assertEqual(row['empty_days'], [22])
        self.assertEqual(len(row['card_ids']), 2)

    def test_approved_card_beats_pending(self):
        emp = self._employee('Approved')
        self._card(emp, status='APPROVED', worked=self._full_month_except(3), sick=[3],
                   created=datetime(2026, 6, 10, tzinfo=timezone.utc))
        # Newer pending card claims day 3 was worked — the approved value wins.
        self._card(emp, worked=[3], created=datetime(2026, 7, 1, tzinfo=timezone.utc))
        row = self._row(self._rows(), emp)
        self.assertEqual(row['sick_days'], [3])
        # The unreviewed card means the month may still change.
        self.assertEqual(row['card_status'], svc.CARD_PENDING)

    def test_card_status_approved_only_when_all_cards_approved(self):
        emp = self._employee('All approved')
        self._card(emp, status='APPROVED', worked=self._full_month_except(3))
        row = self._row(self._rows(), emp)
        self.assertEqual(row['card_status'], svc.CARD_APPROVED)
        self.assertEqual(row['review_card_id'], row['card_ids'][0])

    def test_rejected_card_ignored(self):
        emp = self._employee('Rejected')
        self._card(emp, worked=self._full_month_except(9))
        self._card(emp, status='REJECTED', worked=[9], created=datetime(2026, 7, 2, tzinfo=timezone.utc))
        self.assertEqual(self._row(self._rows(), emp)['empty_days'], [9])

    def test_card_without_day_rows_skipped(self):
        emp = self._employee('Pending extraction')
        self._card(emp)
        result = self._rows()
        self.assertIsNone(self._row(result, emp))
        self.assertEqual(result['summary']['skipped_no_day_data'], 1)

    # -- API -------------------------------------------------------------
    def test_exclusions_roundtrip(self):
        emp = self._employee('Excluded')
        self._card(emp, worked=self._full_month_except(1))
        db.session.commit()

        res = self.client.post('/api/absences/exclusions', headers=self.admin_headers, json={
            'processing_month': MONTH_PARAM, 'employee_ids': [str(emp.id)], 'excluded': True,
            'reason': 'known leave',
        })
        self.assertEqual(res.status_code, 200)
        data = self.client.get(f'/api/absences?month={MONTH_PARAM}', headers=self.admin_headers).get_json()['data']
        self.assertEqual(data['rows'], [])
        self.assertEqual(data['excluded_rows'][0]['exclusion_reason'], 'known leave')

        res = self.client.post('/api/absences/exclusions', headers=self.admin_headers, json={
            'processing_month': MONTH_PARAM, 'employee_ids': [str(emp.id)], 'excluded': False,
        })
        self.assertEqual(res.status_code, 200)
        data = self.client.get(f'/api/absences?month={MONTH_PARAM}', headers=self.admin_headers).get_json()['data']
        self.assertEqual(len(data['rows']), 1)
        self.assertEqual(data['excluded_rows'], [])

    def test_exclusion_rejects_foreign_employee(self):
        res = self.client.post('/api/absences/exclusions', headers=self.admin_headers, json={
            'processing_month': MONTH_PARAM, 'employee_ids': [str(uuid.uuid4())], 'excluded': True,
        })
        self.assertEqual(res.status_code, 404)

    def test_settings_upsert_and_validation(self):
        for days in ([1, 2], [5]):
            res = self.client.put('/api/absences/settings', headers=self.admin_headers,
                                  json={'processing_month': MONTH_PARAM, 'ignored_days': days})
            self.assertEqual(res.status_code, 200)
        res = self.client.get(f'/api/absences/settings?month={MONTH_PARAM}', headers=self.admin_headers)
        self.assertEqual(res.get_json()['data']['ignored_days'], [5])
        self.assertEqual(AbsenceMonthSettings.query.filter_by(business_id=self.business.id).count(), 1)

        res = self.client.put('/api/absences/settings', headers=self.admin_headers,
                              json={'processing_month': MONTH_PARAM, 'ignored_days': [31]})
        self.assertEqual(res.status_code, 400)

    def test_employee_days_upsert_clear_and_validation(self):
        emp = self._employee('Worker')
        db.session.commit()
        url = '/api/absences/employee-days'
        for days in ([1, 2], [3]):
            res = self.client.put(url, headers=self.admin_headers, json={
                'processing_month': MONTH_PARAM, 'employee_id': str(emp.id), 'ignored_days': days})
            self.assertEqual(res.status_code, 200)
        rows = AbsenceEmployeeDaySettings.query.filter_by(business_id=self.business.id).all()
        self.assertEqual([r.ignored_days for r in rows], [[3]])

        res = self.client.put(url, headers=self.admin_headers, json={
            'processing_month': MONTH_PARAM, 'employee_id': str(emp.id), 'ignored_days': []})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(AbsenceEmployeeDaySettings.query.filter_by(business_id=self.business.id).count(), 0)

        res = self.client.put(url, headers=self.admin_headers, json={
            'processing_month': MONTH_PARAM, 'employee_id': str(emp.id), 'ignored_days': [31]})
        self.assertEqual(res.status_code, 400)
        res = self.client.put(url, headers=self.admin_headers, json={
            'processing_month': MONTH_PARAM, 'employee_id': str(uuid.uuid4()), 'ignored_days': [1]})
        self.assertEqual(res.status_code, 404)
        # Bulk: same days for several employees, replacing what they had.
        emp2 = self._employee('Worker 2')
        db.session.commit()
        res = self.client.put(url, headers=self.admin_headers, json={
            'processing_month': MONTH_PARAM, 'employee_ids': [str(emp.id), str(emp2.id)],
            'ignored_days': [4, 5]})
        self.assertEqual(res.status_code, 200)
        self.assertEqual(res.get_json()['data']['updated'], 2)
        rows = AbsenceEmployeeDaySettings.query.filter_by(business_id=self.business.id).all()
        self.assertEqual(sorted(r.ignored_days for r in rows), [[4, 5], [4, 5]])
        res = self.client.put(url, headers=self.admin_headers, json={
            'processing_month': MONTH_PARAM, 'employee_ids': [str(emp.id), str(uuid.uuid4())],
            'ignored_days': [1]})
        self.assertEqual(res.status_code, 404)
        res = self.client.put(url, headers=self.admin_headers, json={
            'processing_month': MONTH_PARAM, 'employee_ids': [], 'ignored_days': [1]})
        self.assertEqual(res.status_code, 400)

        res = self.client.put(url, headers=self.fm_headers, json={
            'processing_month': MONTH_PARAM, 'employee_id': str(emp.id), 'ignored_days': [1]})
        self.assertEqual(res.status_code, 403)

    def test_writes_are_admin_only(self):
        res = self.client.put('/api/absences/settings', headers=self.fm_headers,
                              json={'processing_month': MONTH_PARAM, 'ignored_days': []})
        self.assertEqual(res.status_code, 403)
        res = self.client.post('/api/absences/exclusions', headers=self.fm_headers, json={
            'processing_month': MONTH_PARAM, 'employee_ids': [str(uuid.uuid4())],
        })
        self.assertEqual(res.status_code, 403)

    def test_field_manager_scoped_to_own_sites(self):
        emp_a = self._employee('A', self.site_a)
        emp_b = self._employee('B', self.site_b)
        self._card(emp_a, worked=[1])
        self._card(emp_b, worked=[1])
        db.session.commit()
        data = self.client.get(f'/api/absences?month={MONTH_PARAM}', headers=self.fm_headers).get_json()['data']
        self.assertEqual({r['employee_id'] for r in data['rows']}, {str(emp_a.id)})

    def test_export(self):
        emp = self._employee('Export')
        self._card(emp, worked=[1])
        db.session.commit()
        res = self.client.get(f'/api/absences/export?month={MONTH_PARAM}', headers=self.admin_headers)
        self.assertEqual(res.status_code, 200)
        self.assertIn('spreadsheetml', res.mimetype)


if __name__ == '__main__':
    unittest.main()
