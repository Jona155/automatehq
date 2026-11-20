"""The generic "worked at another site" day marker in site reports."""
import unittest
import uuid
from copy import copy
from datetime import date
from types import SimpleNamespace
from unittest.mock import patch

from openpyxl import Workbook

from backend.app.api import sites as sites_api
from backend.app.api.sites import (
    OTHER_SITE_FILL,
    OTHER_SITE_LABEL,
    _populate_template_core_sheet,
)
from backend.tests.test_hours_matrix_prefetch import _FakeQuery, _FakeSession, _ranked_subquery


def _entry(card_id, day, hours, site=None, status=None, comment=None):
    return SimpleNamespace(
        work_card_id=card_id, day_of_month=day, total_hours=hours,
        day_status=status, attributed_site_id=site, comment=comment,
    )


def _load(site_ids, employees, card_site, employee, day_entries, card_id):
    best_cards_rows = [SimpleNamespace(
        work_card_id=card_id, site_id=card_site, employee_id=employee.id,
        review_status='APPROVED', monthly_total_hours=None,
    )]
    fake_session = _FakeSession([
        _FakeQuery(stage='home_employees', data=employees),
        _FakeQuery(stage='visiting_ids', data=[(employee.id,)]),
        _FakeQuery(stage='ranked_cards', subquery_obj=_ranked_subquery()),
        _FakeQuery(stage='best_cards', data=best_cards_rows),
        _FakeQuery(stage='day_entries', data=day_entries),
    ])
    with patch.object(sites_api.db, 'session', fake_session):
        results = sites_api.load_hours_matrix_for_sites(
            site_ids=site_ids,
            processing_month='2026-11-01',
            approved_only=False,
            include_inactive=True,
            business_id=uuid.uuid4(),
        )
    # The marker must not cost any extra queries.
    assert fake_session.query_calls == 5
    return results


class OtherSiteDaysLoaderTests(unittest.TestCase):
    def test_two_sites_marked_reciprocally(self):
        site_x, site_y = uuid.uuid4(), uuid.uuid4()
        employee = SimpleNamespace(id=uuid.uuid4(), site_id=site_x, full_name='Dana', passport_id='P1')
        card_id = uuid.uuid4()
        entries = [_entry(card_id, d, 8.0) for d in range(1, 9)]
        entries += [_entry(card_id, d, 8.0, site=site_y) for d in range(9, 16)]

        results = _load([site_x, site_y], [employee], site_x, employee, entries, card_id)
        emp = str(employee.id)

        self.assertEqual(results[site_x]['other_site_days'][emp], list(range(9, 16)))
        self.assertEqual(results[site_y]['other_site_days'][emp], list(range(1, 9)))
        # Local hours unaffected: each site only sums its own days.
        self.assertEqual(sorted(results[site_x]['matrix'][emp]), list(range(1, 9)))
        self.assertEqual(sorted(results[site_y]['matrix'][emp]), list(range(9, 16)))

    def test_three_sites_and_out_of_scope_site(self):
        site_x, site_y, site_z = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        employee = SimpleNamespace(id=uuid.uuid4(), site_id=site_x, full_name='Dana', passport_id='P1')
        card_id = uuid.uuid4()
        entries = [
            _entry(card_id, 1, 8.0),
            _entry(card_id, 2, 8.0, site=site_y),
            _entry(card_id, 3, 8.0, site=site_z),
        ]

        # All three in scope.
        results = _load([site_x, site_y, site_z], [employee], site_x, employee, entries, card_id)
        emp = str(employee.id)
        self.assertEqual(results[site_x]['other_site_days'][emp], [2, 3])
        self.assertEqual(results[site_y]['other_site_days'][emp], [1, 3])
        self.assertEqual(results[site_z]['other_site_days'][emp], [1, 2])

        # Only X requested: days at Y and Z still count.
        results = _load([site_x], [employee], site_x, employee, entries, card_id)
        self.assertEqual(results[site_x]['other_site_days'][emp], [2, 3])
        # Server-side detail for the named export option: which site, per day.
        self.assertEqual(results[site_x]['other_site_ids'][emp], {2: [site_y], 3: [site_z]})

    def test_status_zero_and_missing_days_are_not_marked(self):
        site_x, site_y = uuid.uuid4(), uuid.uuid4()
        employee = SimpleNamespace(id=uuid.uuid4(), site_id=site_x, full_name='Dana', passport_id='P1')
        card_id = uuid.uuid4()
        entries = [
            _entry(card_id, 1, 8.0),
            _entry(card_id, 2, None, site=site_y, status='VACATION'),
            _entry(card_id, 3, 0.0, site=site_y),
            _entry(card_id, 4, None, site=site_y),
            _entry(card_id, 5, 6.0, site=site_y),
        ]
        results = _load([site_x], [employee], site_x, employee, entries, card_id)
        self.assertEqual(results[site_x]['other_site_days'], {str(employee.id): [5]})

    def test_results_hold_day_numbers_only(self):
        site_x, site_y = uuid.uuid4(), uuid.uuid4()
        employee = SimpleNamespace(id=uuid.uuid4(), site_id=site_x, full_name='Dana', passport_id='P1')
        card_id = uuid.uuid4()
        entries = [_entry(card_id, 1, 8.0), _entry(card_id, 2, 8.0, site=site_y)]
        results = _load([site_x], [employee], site_x, employee, entries, card_id)
        self.assertNotIn(str(site_y), repr(results[site_x]['other_site_days']))


class OtherSiteSheetTests(unittest.TestCase):
    def _populate(self, matrix, other_site_days, comment_matrix=None, other_site_labels=None):
        workbook = Workbook()
        ws = workbook.active
        base_style = copy(ws['A1']._style)
        employee = SimpleNamespace(id=uuid.uuid4(), passport_id='P-1', full_name='Dana Levi')
        emp = str(employee.id)
        _populate_template_core_sheet(
            ws=ws,
            employees=[employee],
            matrix={emp: matrix},
            month_date=date(2026, 2, 1),  # Feb 2026: days 1-6 are Sun-Fri
            style_header=base_style,
            style_body=base_style,
            style_total=base_style,
            other_site_days={emp: other_site_days},
            comment_matrix={emp: comment_matrix or {}},
            other_site_labels={emp: other_site_labels} if other_site_labels else None,
        )
        return ws

    def test_empty_day_shows_label_and_total_formula_unchanged(self):
        ws = self._populate({1: 8.0}, [2])
        local, marked = ws.cell(row=3, column=2), ws.cell(row=4, column=2)
        self.assertEqual(local.value, 8.0)
        self.assertEqual(marked.value, OTHER_SITE_LABEL)
        self.assertEqual(marked.fill.fgColor.rgb, OTHER_SITE_FILL.fgColor.rgb)
        # Feb 2026 has 28 days → total row 31, SUM over rows 3..30 (text ignored).
        self.assertEqual(ws.cell(row=31, column=2).value, '=SUM(B3:B30)')

    def test_same_day_local_hours_kept_with_note(self):
        ws = self._populate({1: 8.0}, [1], comment_matrix={1: 'late start'})
        cell = ws.cell(row=3, column=2)
        self.assertEqual(cell.value, 8.0)
        self.assertIn(OTHER_SITE_LABEL, cell.comment.text)
        self.assertIn('late start', cell.comment.text)

    def test_named_label_replaces_generic_one(self):
        ws = self._populate({1: 8.0}, [1, 2], other_site_labels={1: 'עבד באתר: Beta', 2: 'עבד באתר: Beta'})
        self.assertEqual(ws.cell(row=4, column=2).value, 'עבד באתר: Beta')
        self.assertIn('עבד באתר: Beta', ws.cell(row=3, column=2).comment.text)

    def test_marker_beats_saturday_fallback(self):
        # Feb 7 2026 is a Saturday (row 9).
        ws = self._populate({}, [7])
        self.assertEqual(ws.cell(row=9, column=2).value, OTHER_SITE_LABEL)


class OtherSiteNamesExportTests(unittest.TestCase):
    """The batch export's show_other_site_names option (DB-backed)."""

    def setUp(self):
        from dotenv import load_dotenv
        load_dotenv()
        from backend.app import create_app, db
        from backend.app.auth_utils import encode_auth_token
        from backend.app.models import Business, Employee, Site, User, WorkCard, WorkCardDayEntry

        self.db = db
        self.app = create_app()
        self.client = self.app.test_client()
        self.ctx = self.app.app_context()
        self.ctx.push()

        suffix = uuid.uuid4().hex[:8]
        business = Business(name=f'Other Site {suffix}', code=f'other-site-{suffix}', is_active=True)
        db.session.add(business)
        db.session.flush()
        admin = User(business_id=business.id, full_name='Admin', email=f'other-site-{suffix}@example.com',
                     role='ADMIN', password_hash='n/a', is_active=True)
        self.site_a = Site(business_id=business.id, site_name=f'Alpha {suffix}', is_active=True)
        self.site_b = Site(business_id=business.id, site_name=f'Beta {suffix}', is_active=True)
        db.session.add_all([admin, self.site_a, self.site_b])
        db.session.flush()
        employee = Employee(business_id=business.id, site_id=self.site_a.id, full_name='Dana Levi',
                            passport_id=f'OS{suffix}', is_active=True, status='ACTIVE')
        db.session.add(employee)
        db.session.flush()
        card = WorkCard(business_id=business.id, site_id=self.site_a.id, employee_id=employee.id,
                        processing_month=date(2026, 2, 1), source='ADMIN_SINGLE', review_status='APPROVED')
        db.session.add(card)
        db.session.flush()
        db.session.add_all([
            WorkCardDayEntry(work_card_id=card.id, day_of_month=2, total_hours=8, source='MANUAL'),
            WorkCardDayEntry(work_card_id=card.id, day_of_month=3, total_hours=8, source='MANUAL',
                             attributed_site_id=self.site_b.id),
        ])
        db.session.commit()

        self.business_id = business.id
        self.headers = {'Authorization': f'Bearer {encode_auth_token(admin.id)}'}
        # Export only site A: the other site (B) is outside the selection.
        self.url = (f'/api/sites/summary/export-batch?processing_month=2026-02-01'
                    f'&site_ids={self.site_a.id}')

    def tearDown(self):
        from backend.app.repositories.business_repository import BusinessRepository
        try:
            BusinessRepository().hard_delete(self.business_id)
        except Exception:
            self.db.session.rollback()
        self.ctx.pop()

    def _sheet(self, query=''):
        from io import BytesIO
        from openpyxl import load_workbook
        response = self.client.get(self.url + query, headers=self.headers)
        self.assertEqual(response.status_code, 200)
        return load_workbook(BytesIO(response.data)).worksheets[0]

    def _all_text(self, ws):
        return ' '.join(str(c.value) for row in ws.iter_rows() for c in row if c.value is not None)

    def test_default_export_is_anonymous(self):
        ws = self._sheet()
        self.assertEqual(ws.cell(row=5, column=2).value, OTHER_SITE_LABEL)  # Feb 3
        self.assertNotIn(self.site_b.site_name, self._all_text(ws))

    def test_opt_in_names_the_other_site(self):
        ws = self._sheet('&show_other_site_names=true')
        self.assertEqual(ws.cell(row=5, column=2).value, f'עבד באתר: {self.site_b.site_name}')
        self.assertEqual(ws.cell(row=4, column=2).value, 8)  # local hours untouched


if __name__ == '__main__':
    unittest.main()
