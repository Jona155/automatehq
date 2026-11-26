"""End-to-end tests for the site report editor: preview, save, and that every
existing export path reproduces saved changes — while source data, and reports
with the feature off, stay untouched."""
import os
import unittest
import uuid
from datetime import date
from io import BytesIO
from unittest.mock import patch

from dotenv import load_dotenv
from openpyxl import load_workbook

load_dotenv()

from backend.app import create_app, db
from backend.app.auth_utils import encode_auth_token
from backend.app.models.audit import AuditEvent
from backend.app.models.business import Business
from backend.app.models.report_adjustments import ReportAdjustment, ReportNote
from backend.app.models.sites import Employee, Site
from backend.app.models.users import User
from backend.app.models.work_cards import WorkCard, WorkCardDayEntry
from backend.app.observability import QueryCounter
from backend.app.repositories.business_repository import BusinessRepository
from backend.app.services import missing_cards_service as mcs
from backend.app.services.sites import report_adjustments_service as svc

MONTH = '2026-02-01'


class SiteReportEditorTests(unittest.TestCase):
    def setUp(self):
        self.env = patch.dict(os.environ, {'REPORT_EDITOR_ENABLED': 'true'})
        self.env.start()
        self.app = create_app()
        self.client = self.app.test_client()
        self.ctx = self.app.app_context()
        self.ctx.push()

        suffix = uuid.uuid4().hex[:8]
        self.business = Business(name=f'Report Editor {suffix}', code=f'report-editor-{suffix}', is_active=True)
        self.other_business = Business(name=f'Other {suffix}', code=f'report-editor-other-{suffix}', is_active=True)
        db.session.add_all([self.business, self.other_business])
        db.session.flush()

        self.admin = User(business_id=self.business.id, full_name='Report Admin',
                          email=f'report-admin-{suffix}@example.com', role='ADMIN',
                          password_hash='n/a', is_active=True)
        self.viewer = User(business_id=self.business.id, full_name='Field Manager',
                           email=f'report-fm-{suffix}@example.com', role='FIELD_MANAGER',
                           password_hash='n/a', is_active=True)
        self.site = Site(business_id=self.business.id, site_name=f'Editor Site {suffix}',
                         is_active=True, hourly_tariff=50)
        self.foreign_site = Site(business_id=self.other_business.id, site_name=f'Foreign {suffix}', is_active=True)
        db.session.add_all([self.admin, self.viewer, self.site, self.foreign_site])
        db.session.flush()

        # Sorted by name for export: Alice is column B / row 2, Bob is column C / row 3.
        self.alice = Employee(business_id=self.business.id, site_id=self.site.id,
                              full_name='Alice A', passport_id=f'A{suffix}', is_active=True)
        self.bob = Employee(business_id=self.business.id, site_id=self.site.id,
                            full_name='Bob B', passport_id=f'B{suffix}', is_active=True)
        db.session.add_all([self.alice, self.bob])
        db.session.flush()

        self.card = WorkCard(business_id=self.business.id, site_id=self.site.id, employee_id=self.alice.id,
                             processing_month=date(2026, 2, 1), source='ADMIN_SINGLE',
                             review_status='APPROVED')
        db.session.add(self.card)
        db.session.flush()
        db.session.add_all([
            WorkCardDayEntry(work_card_id=self.card.id, day_of_month=2, total_hours=8, source='EXTRACTED', is_valid=True),
            WorkCardDayEntry(work_card_id=self.card.id, day_of_month=3, total_hours=9, source='EXTRACTED',
                             is_valid=True, comment='review comment'),
            WorkCardDayEntry(work_card_id=self.card.id, day_of_month=4, day_status='SICK', source='MANUAL', is_valid=True),
        ])
        db.session.commit()

        self.business_id = self.business.id
        self.other_business_id = self.other_business.id
        self.site_id = self.site.id
        self.alice_id = str(self.alice.id)
        self.bob_id = str(self.bob.id)
        self.headers = {'Authorization': f'Bearer {encode_auth_token(self.admin.id)}'}

    def tearDown(self):
        db.session.rollback()
        try:
            BusinessRepository().hard_delete(self.business_id)
            BusinessRepository().hard_delete(self.other_business_id)
        except Exception:
            db.session.rollback()
            raise
        finally:
            self.ctx.pop()
            self.env.stop()

    # --- helpers ---

    def _url(self, report_type='summary', site_id=None):
        return f'/api/sites/{site_id or self.site_id}/reports/{report_type}'

    def _get(self, report_type='summary'):
        response = self.client.get(f'{self._url(report_type)}?processing_month={MONTH}', headers=self.headers)
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        return response.get_json()['data']

    def _put(self, cells=None, notes=None, revision=0, report_type='summary', headers=None):
        return self.client.put(self._url(report_type), headers=headers or self.headers, json={
            'processing_month': MONTH, 'base_revision': revision,
            'cells': cells or [], 'notes': notes or [],
        })

    def _cell(self, payload, row, col):
        for cell in payload['model']['cells']:
            if cell['row'] == row and cell['col'] == col:
                return cell
        return None

    def _sheet(self, path):
        response = self.client.get(path, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        return load_workbook(BytesIO(response.data)).worksheets[0]

    def _summary_sheet(self):
        return self._sheet(f'/api/sites/{self.site_id}/summary/export?processing_month={MONTH}')

    def _salary_sheet(self):
        return self._sheet(f'/api/sites/{self.site_id}/salary-template/export?processing_month={MONTH}')

    # --- preview ---

    def test_preview_shows_source_data_before_any_edit(self):
        payload = self._get()
        self.assertEqual(payload['revision'], 0)
        self.assertEqual(payload['adjustments'], [])
        self.assertEqual(payload['employee_count'], 2)
        self.assertFalse(payload['has_unapproved_cards'])
        # Summary: Alice = column 2, day 2 = row 4.
        cell = self._cell(payload, 4, 2)
        self.assertEqual((cell['value'], cell['kind'], cell['employee_id'], cell['day']), (8.0, 'input', self.alice_id, 2))
        self.assertEqual(self._cell(payload, 6, 2)['value'], 'מחלה')
        self.assertEqual(self._cell(payload, 5, 2)['note'], 'review comment')
        self.assertEqual(self._cell(payload, 31, 2)['value'], 17.0)  # total row
        self.assertEqual(payload['day_comments'], [{'employee_id': self.alice_id, 'day': 3, 'text': 'review comment'}])

    def test_salary_preview_uses_rows_per_employee(self):
        payload = self._get('salary')
        cell = self._cell(payload, 2, 3)  # Alice row 2, day 2 = column 3
        self.assertEqual((cell['value'], cell['employee_id'], cell['day']), (8.0, self.alice_id, 2))

    def test_requires_admin_and_own_business(self):
        fm_headers = {'Authorization': f'Bearer {encode_auth_token(self.viewer.id)}'}
        self.assertEqual(self.client.get(f'{self._url()}?processing_month={MONTH}', headers=fm_headers).status_code, 403)
        self.assertEqual(self._put(headers=fm_headers).status_code, 403)
        foreign = self.client.get(f'{self._url(site_id=self.foreign_site.id)}?processing_month={MONTH}', headers=self.headers)
        self.assertEqual(foreign.status_code, 404)
        self.assertEqual(self.client.get(f'/api/sites/{self.site_id}/reports/other?processing_month={MONTH}', headers=self.headers).status_code, 404)

    # --- saving ---

    def test_saved_edit_reaches_every_report_and_the_attendance_data(self):
        response = self._put(cells=[
            {'employee_id': self.alice_id, 'day': 2, 'value': 10.5, 'expected': 8},
            {'employee_id': self.bob_id, 'day': 5, 'value': 'חופשה', 'expected': None},
        ])
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json()['data']
        self.assertEqual(payload['revision'], 1)
        self.assertEqual(self._cell(payload, 4, 2)['value'], 10.5)
        self.assertEqual(self._cell(payload, 31, 2)['value'], 19.5)
        self.assertEqual(self._cell(payload, 7, 3)['value'], 'חופשה')
        # Nothing is layered over the data any more.
        self.assertEqual(payload['adjustments'], [])
        self.assertEqual(ReportAdjustment.query.filter_by(site_id=self.site_id).count(), 0)

        # The Salary preview and both downloads show it too.
        self.assertEqual(self._cell(self._get('salary'), 2, 3)['value'], 10.5)
        self.assertEqual(self._summary_sheet()['B4'].value, 10.5)
        self.assertEqual(self._summary_sheet()['C7'].value, 'חופשה')
        self.assertEqual(self._salary_sheet().cell(row=2, column=3).value, 10.5)

        batch = self._sheet(f'/api/sites/summary/export-batch?processing_month={MONTH}&site_ids={self.site_id}')
        self.assertEqual(batch['B4'].value, 10.5)
        salary_batch = self.client.get(f'/api/sites/salary-template/export-batch?processing_month={MONTH}', headers=self.headers)
        workbook = load_workbook(BytesIO(salary_batch.data))
        self.assertEqual(workbook[self.site.site_name[:31]].cell(row=2, column=3).value, 10.5)

        # The attendance data itself changed: the day entry (as a human edit),
        # and with it the on-screen matrix every other screen reads.
        entry = WorkCardDayEntry.query.filter_by(work_card_id=self.card.id, day_of_month=2).one()
        self.assertEqual(float(entry.total_hours), 10.5)
        self.assertEqual(entry.source, 'MANUAL')
        self.assertEqual(entry.updated_by_user_id, self.admin.id)
        matrix = self.client.get(f'/api/sites/{self.site_id}/matrix?processing_month={MONTH}', headers=self.headers).get_json()['data']
        self.assertEqual(matrix['matrix'][self.alice_id]['2'], 10.5)
        # The card stays approved, so the report keeps reading it.
        self.assertEqual(db.session.get(WorkCard, self.card.id).review_status, 'APPROVED')

        events = AuditEvent.query.filter_by(business_id=self.business_id, event_type='REPORT_DAY_EDIT').all()
        self.assertEqual(len(events), 2)
        alice_event = next(e for e in events if str(e.employee_id) == self.alice_id)
        self.assertEqual(alice_event.event_metadata['previous_value'], {'hours': 8.0, 'status': None})
        self.assertEqual(alice_event.event_metadata['new_value'], {'hours': 10.5, 'status': None})
        self.assertEqual(alice_event.actor_user_id, self.admin.id)
        self.assertEqual(alice_event.work_card_id, self.card.id)

    def test_filling_an_employee_with_no_card_creates_a_manual_card(self):
        response = self._put(cells=[{'employee_id': self.bob_id, 'day': 5, 'value': 7},
                                    {'employee_id': self.bob_id, 'day': 6, 'value': 'SICK'}])
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        self.assertEqual(response.get_json()['data']['created_manual_cards'], 1)

        [card] = WorkCard.query.filter_by(employee_id=self.bob.id).all()
        self.assertEqual((card.source, card.review_status, card.site_id), ('MANUAL', 'NEEDS_REVIEW', self.site_id))
        self.assertEqual(card.uploaded_by_user_id, self.admin.id)
        days = {e.day_of_month: (float(e.total_hours) if e.total_hours is not None else None, e.day_status)
                for e in card.day_entries}
        self.assertEqual(days, {5: (7.0, None), 6: (None, 'SICK')})

        # A later save reuses the card.
        again = self._put(cells=[{'employee_id': self.bob_id, 'day': 7, 'value': 8}], revision=1)
        self.assertEqual(again.get_json()['data']['created_manual_cards'], 0)
        self.assertEqual(WorkCard.query.filter_by(employee_id=self.bob.id).count(), 1)

        # Missing cards: one unapproved card is a first card only (2 expected)...
        def status():
            rows = mcs.compute_missing(self.business_id, date(2026, 2, 1), today=date(2026, 3, 15))
            return next(r for r in rows if r['employee_id'] == self.bob_id)['status']
        self.assertEqual(status(), mcs.STATUS_PARTIAL)
        # ...and approving it as the whole month settles the employee.
        approved = self.client.post(f'/api/work_cards/{card.id}/approve', headers=self.headers, json={
            'user_id': str(self.admin.id), 'approve_full_month': True,
        })
        self.assertEqual(approved.status_code, 200, approved.get_data(as_text=True))
        db.session.expire_all()
        self.assertEqual(db.session.get(WorkCard, card.id).approved_through_day, 28)
        self.assertEqual(status(), mcs.STATUS_COMPLETE)

    def test_editing_an_approved_card_keeps_it_approved_and_protected(self):
        self._put(cells=[{'employee_id': self.alice_id, 'day': 20, 'value': 7}])
        card = db.session.get(WorkCard, self.card.id)
        self.assertEqual(card.review_status, 'APPROVED')
        self.assertEqual(card.approved_through_day, 20)

    def test_blanking_a_day_clears_the_entry(self):
        self.assertEqual(self._put(cells=[{'employee_id': self.alice_id, 'day': 2, 'value': ''}]).status_code, 200)
        self.assertIsNone(self._summary_sheet()['B4'].value)
        self.assertEqual(self._summary_sheet()['B31'].value, '=SUM(B3:B30)')
        # An intentional blank: the entry stays, emptied, as a human edit.
        entry = WorkCardDayEntry.query.filter_by(work_card_id=self.card.id, day_of_month=2).one()
        self.assertEqual((entry.total_hours, entry.day_status, entry.source), (None, None, 'MANUAL'))

        # There is no separate original to reset to: a reset changes nothing.
        response = self._put(cells=[{'employee_id': self.alice_id, 'day': 2, 'reset': True}], revision=1)
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['data']['revision'], 1)
        self.assertIsNone(self._cell(response.get_json()['data'], 4, 2)['value'])

    def test_setting_the_source_value_stores_no_adjustment(self):
        response = self._put(cells=[{'employee_id': self.alice_id, 'day': 2, 'value': '8'}])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['data']['revision'], 0)  # nothing changed
        self.assertEqual(ReportAdjustment.query.filter_by(site_id=self.site_id).count(), 0)

    def test_invalid_value_saves_nothing(self):
        response = self._put(cells=[
            {'employee_id': self.alice_id, 'day': 2, 'value': 11},
            {'employee_id': self.alice_id, 'day': 3, 'value': 25},
            {'employee_id': self.bob_id, 'day': 6, 'value': 'abc'},
            {'employee_id': str(uuid.uuid4()), 'day': 1, 'value': 1},
            {'employee_id': self.bob_id, 'day': 30, 'value': 1},
        ])
        self.assertEqual(response.status_code, 422)
        errors = response.get_json()['data']['errors']
        self.assertEqual(len(errors), 4)
        self.assertIn({'employee_id': self.alice_id, 'day': 3, 'message': 'מספר השעות חייב להיות בין 0 ל-24'}, errors)
        self.assertEqual(ReportAdjustment.query.filter_by(site_id=self.site_id).count(), 0)
        self.assertEqual(self._get()['revision'], 0)

    def test_stale_editor_cannot_overwrite_a_newer_save(self):
        self.assertEqual(self._put(cells=[{'employee_id': self.alice_id, 'day': 2, 'value': 10}]).status_code, 200)
        stale = self._put(cells=[{'employee_id': self.alice_id, 'day': 2, 'value': 5}], revision=0)
        self.assertEqual(stale.status_code, 409)
        self.assertEqual(stale.get_json()['data']['current_revision'], 1)
        self.assertEqual(self._cell(self._get(), 4, 2)['value'], 10.0)

    # --- notes ---

    def test_report_note_is_per_report_and_exported_with_the_review_comment(self):
        response = self._put(notes=[
            {'employee_id': self.alice_id, 'day': 3, 'text': 'note for recipient'},
            {'employee_id': self.bob_id, 'day': 8, 'text': '  on a blank day '},
        ])
        self.assertEqual(response.status_code, 200, response.get_data(as_text=True))
        payload = response.get_json()['data']
        self.assertIn({'employee_id': self.alice_id, 'day': 3, 'text': 'note for recipient'}, payload['notes'])
        self.assertEqual(self._cell(payload, 5, 2)['note'], 'review comment\nnote for recipient')

        sheet = self._summary_sheet()
        self.assertEqual(sheet['B5'].comment.text, 'review comment\nnote for recipient')
        self.assertEqual(sheet['C10'].comment.text, 'on a blank day')
        # The Salary report keeps only the shared review comment.
        self.assertEqual(self._salary_sheet().cell(row=2, column=4).comment.text, 'review comment')
        self.assertEqual(self._get('salary')['notes'], [])
        # The review comment itself is not modified.
        entry = WorkCardDayEntry.query.filter_by(work_card_id=self.card.id, day_of_month=3).one()
        self.assertEqual(entry.comment, 'review comment')

        removed = self._put(notes=[{'employee_id': self.alice_id, 'day': 3, 'text': ''}], revision=1)
        self.assertEqual(removed.status_code, 200)
        self.assertEqual(self._summary_sheet()['B5'].comment.text, 'review comment')
        self.assertEqual(ReportNote.query.filter_by(site_id=self.site_id).count(), 1)

    # --- changes from other sources ---

    def test_value_changed_elsewhere_is_not_overwritten(self):
        # The editor loaded 8; meanwhile the review screen changed the day to 6.
        entry = WorkCardDayEntry.query.filter_by(work_card_id=self.card.id, day_of_month=2).one()
        entry.total_hours = 6
        db.session.commit()

        stale = self._put(cells=[{'employee_id': self.alice_id, 'day': 2, 'value': 10, 'expected': 8}])
        self.assertEqual(stale.status_code, 422)
        self.assertEqual(stale.get_json()['data']['errors'][0]['message'], svc.STALE_VALUE_MESSAGE)
        db.session.expire_all()
        self.assertEqual(float(WorkCardDayEntry.query.filter_by(
            work_card_id=self.card.id, day_of_month=2).one().total_hours), 6.0)

        # Statuses are compared by what the cell showed (the label).
        fresh = self._put(cells=[{'employee_id': self.alice_id, 'day': 2, 'value': 10, 'expected': 6},
                                 {'employee_id': self.alice_id, 'day': 4, 'value': 3, 'expected': 'מחלה'}])
        self.assertEqual(fresh.status_code, 200, fresh.get_data(as_text=True))
        self.assertEqual(self._summary_sheet()['B4'].value, 10)
        self.assertEqual(self._summary_sheet()['B6'].value, 3)

    # --- legacy adjustments (saved by the first editor) and their migration ---

    def _legacy(self, employee, day, hours=None, status=None, base=None):
        adjustment = ReportAdjustment(
            business_id=self.business_id, site_id=self.site_id, processing_month=date(2026, 2, 1),
            employee_id=employee.id, day_of_month=day, hours=hours, day_status=status,
            base_value=base or {'hours': None, 'status': None}, updated_by_user_id=self.admin.id,
        )
        db.session.add(adjustment)
        db.session.commit()
        return adjustment

    def _migrate(self):
        outcomes = svc.apply_pending_adjustments(self.business_id, db.session.get(Site, self.site_id), date(2026, 2, 1))
        db.session.commit()
        return {(o['employee_id'], o['day']): o['outcome'] for o in outcomes}

    def test_legacy_adjustments_apply_until_migrated_then_become_data(self):
        self._legacy(self.alice, 2, hours=10, base={'hours': 8, 'status': None})
        self._legacy(self.alice, 3, hours=9, base={'hours': 9, 'status': None})   # same as the data
        self._legacy(self.bob, 5, status='VACATION')                               # no card at all

        before = self._get()
        self.assertEqual(len(before['adjustments']), 3)
        self.assertEqual(self._cell(before, 4, 2)['value'], 10.0)
        cells_before = [(c['row'], c['col'], c['value']) for c in before['model']['cells']]

        self.assertEqual(self._migrate(), {
            (self.alice_id, 2): 'applied', (self.alice_id, 3): 'already_matches', (self.bob_id, 5): 'applied',
        })

        after = self._get()
        self.assertEqual(after['adjustments'], [])
        self.assertEqual([(c['row'], c['col'], c['value']) for c in after['model']['cells']], cells_before)
        entry = WorkCardDayEntry.query.filter_by(work_card_id=self.card.id, day_of_month=2).one()
        self.assertEqual((float(entry.total_hours), entry.source), (10.0, 'MANUAL'))
        [bob_card] = WorkCard.query.filter_by(employee_id=self.bob.id).all()
        self.assertEqual((bob_card.source, bob_card.day_entries[0].day_status), ('MANUAL', 'VACATION'))
        # Kept as a record, stamped; a second run has nothing left to do.
        self.assertEqual(ReportAdjustment.query.filter(
            ReportAdjustment.site_id == self.site_id, ReportAdjustment.migrated_at.isnot(None)).count(), 3)
        self.assertEqual(self._migrate(), {})

    def test_first_save_of_a_site_month_migrates_its_legacy_adjustments(self):
        self._legacy(self.alice, 2, hours=10, base={'hours': 8, 'status': None})
        saved = self._put(cells=[{'employee_id': self.alice_id, 'day': 20, 'value': 5, 'expected': None}])
        self.assertEqual(saved.status_code, 200, saved.get_data(as_text=True))
        self.assertEqual(saved.get_json()['data']['adjustments'], [])
        entry = WorkCardDayEntry.query.filter_by(work_card_id=self.card.id, day_of_month=2).one()
        self.assertEqual(float(entry.total_hours), 10.0)
        self.assertEqual(self._summary_sheet()['B4'].value, 10)

    def test_legacy_adjustment_on_another_sites_day_stays_an_overlay(self):
        self._lend_alice_to_another_site()
        self._legacy(self.alice, 10, hours=4)
        self.assertEqual(self._migrate(), {(self.alice_id, 10): 'blocked'})
        # The report still shows it, and the other site's day is untouched.
        self.assertEqual(self._summary_sheet()['B12'].value, 4)
        entry = WorkCardDayEntry.query.filter_by(work_card_id=self.card.id, day_of_month=10).one()
        self.assertEqual(float(entry.total_hours), 8.0)
        self.assertIsNotNone(entry.attributed_site_id)
        # The user can still drop it from the editor.
        dropped = self._put(cells=[{'employee_id': self.alice_id, 'day': 10, 'reset': True}])
        self.assertEqual(dropped.status_code, 200)
        self.assertEqual(self._summary_sheet()['B12'].value, 'עבד באתר אחר')

    def test_migrate_command_is_a_dry_run_unless_told_to_apply(self):
        self._legacy(self.alice, 2, hours=10, base={'hours': 8, 'status': None})
        runner = self.app.test_cli_runner()
        args = ['report-edits', 'migrate', '--business', self.business.code]

        dry = runner.invoke(args=args)
        self.assertEqual(dry.exit_code, 0, dry.output)
        self.assertIn('DRY RUN', dry.output)
        self.assertIn('8 -> 10', dry.output)
        self.assertIn('reports identical before and after', dry.output)
        db.session.expire_all()
        self.assertEqual(float(WorkCardDayEntry.query.filter_by(
            work_card_id=self.card.id, day_of_month=2).one().total_hours), 8.0)
        self.assertEqual(ReportAdjustment.query.filter_by(site_id=self.site_id, migrated_at=None).count(), 1)

        applied = runner.invoke(args=args + ['--apply'])
        self.assertEqual(applied.exit_code, 0, applied.output)
        db.session.expire_all()
        self.assertEqual(float(WorkCardDayEntry.query.filter_by(
            work_card_id=self.card.id, day_of_month=2).one().total_hours), 10.0)
        self.assertEqual(ReportAdjustment.query.filter_by(site_id=self.site_id, migrated_at=None).count(), 0)
        self.assertIn('0 site-month(s)', runner.invoke(args=args).output)

    def test_legacy_adjustment_for_an_employee_no_longer_in_the_report_is_not_moved(self):
        self._legacy(self.bob, 5, hours=7)
        bob = db.session.get(Employee, self.bob.id)
        bob.is_active = False  # Summary excludes inactive employees
        db.session.commit()

        payload = self._get()
        self.assertEqual(payload['employee_count'], 1)
        self.assertEqual(payload['adjustments'], [])
        self.assertEqual(payload['orphan_adjustments'], [
            {'employee_id': self.bob_id, 'day': 5, 'value': {'hours': 7.0, 'status': None}},
        ])
        sheet = self._summary_sheet()
        self.assertIsNone(sheet['B7'].value)   # Alice's day 5 did not inherit it
        self.assertIsNone(sheet['C7'].value)

    # --- feature flag / safety ---

    def test_flag_off_hides_the_editor_and_ignores_legacy_adjustments(self):
        self._legacy(self.alice, 2, hours=10, base={'hours': 8, 'status': None})
        with patch.dict(os.environ, {'REPORT_EDITOR_ENABLED': 'false'}):
            self.assertEqual(self.client.get(f'{self._url()}?processing_month={MONTH}', headers=self.headers).status_code, 404)
            self.assertEqual(self._put().status_code, 404)
            status = self.client.get('/api/sites/report-editor/status', headers=self.headers).get_json()['data']
            self.assertEqual(status, {'enabled': False})
            self.assertEqual(self._summary_sheet()['B4'].value, 8)
            with QueryCounter(db.engine) as counter:
                self._summary_sheet()
            flag_off_queries = counter.count
        with QueryCounter(db.engine) as counter:
            self._summary_sheet()
        # The overlay costs a fixed two queries (adjustments + notes), no more.
        self.assertEqual(counter.count - flag_off_queries, 2)

    def test_export_fails_instead_of_silently_dropping_adjustments(self):
        self._legacy(self.alice, 2, hours=10, base={'hours': 8, 'status': None})
        with patch(
            'backend.app.services.sites.report_adjustments_service.overlay_site_results',
            side_effect=RuntimeError('adjustments unavailable'),
        ):
            response = self.client.get(
                f'/api/sites/{self.site_id}/summary/export?processing_month={MONTH}', headers=self.headers)
            self.assertEqual(response.status_code, 500)
            self.assertNotEqual(response.mimetype, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')

    # --- other-site names ---

    def _lend_alice_to_another_site(self):
        other = Site(business_id=self.business_id, site_name='Second Site', is_active=True)
        db.session.add(other)
        db.session.flush()
        # Day 10 of Alice's card is attributed to the other site.
        db.session.add(WorkCardDayEntry(work_card_id=self.card.id, day_of_month=10, total_hours=8,
                                        source='EXTRACTED', is_valid=True, attributed_site_id=other.id))
        db.session.commit()

    def test_other_site_is_generic_unless_names_are_requested(self):
        self._lend_alice_to_another_site()
        payload = self._get()
        self.assertTrue(payload['has_other_site_days'])
        self.assertFalse(payload['show_other_site_names'])
        self.assertEqual(self._cell(payload, 12, 2)['value'], 'עבד באתר אחר')
        self.assertEqual(payload['model']['other_site_labels'][self.alice_id]['10'], 'עבד באתר אחר')
        self.assertEqual(self._summary_sheet()['B12'].value, 'עבד באתר אחר')

    def test_named_other_site_matches_between_preview_and_download(self):
        self._lend_alice_to_another_site()
        response = self.client.get(
            f'{self._url()}?processing_month={MONTH}&show_other_site_names=true', headers=self.headers)
        payload = response.get_json()['data']
        self.assertTrue(payload['show_other_site_names'])
        self.assertEqual(self._cell(payload, 12, 2)['value'], 'עבד באתר: Second Site')
        self.assertEqual(self._cell(payload, 12, 2)['kind'], 'input')
        self.assertEqual(payload['model']['other_site_labels'][self.alice_id]['10'], 'עבד באתר: Second Site')

        sheet = self._sheet(
            f'/api/sites/{self.site_id}/summary/export?processing_month={MONTH}&show_other_site_names=true')
        self.assertEqual(sheet['B12'].value, 'עבד באתר: Second Site')
        # The marker is text, so the total still counts only this site's hours.
        self.assertEqual(self._cell(payload, payload['model']['total_row'], 2)['value'], 17)
        self.assertEqual(sheet['B4'].value, 8)
        # That day belongs to the other site's report: it cannot be edited here.
        saved = self.client.put(self._url(), headers=self.headers, json={
            'processing_month': MONTH, 'base_revision': 0, 'show_other_site_names': True,
            'cells': [{'employee_id': self.alice_id, 'day': 10, 'value': 4}], 'notes': [],
        })
        self.assertEqual(saved.status_code, 422)
        self.assertEqual(saved.get_json()['data']['errors'][0]['message'], svc.OTHER_SITE_DAY_MESSAGE)
        self.assertEqual(self._summary_sheet()['B12'].value, 'עבד באתר אחר')

    def test_salary_report_ignores_the_names_option(self):
        self._lend_alice_to_another_site()
        response = self.client.get(
            f"{self._url('salary')}?processing_month={MONTH}&show_other_site_names=true", headers=self.headers)
        payload = response.get_json()['data']
        self.assertFalse(payload['show_other_site_names'])
        self.assertFalse(payload['has_other_site_days'])


if __name__ == '__main__':
    unittest.main()
