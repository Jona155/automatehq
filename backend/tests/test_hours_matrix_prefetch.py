import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import patch

from backend.app.api import sites as sites_api


class _FakeQuery:
    """Mimics just enough of a SQLAlchemy query for load_hours_matrix_for_sites.

    Column selection / filter / join arguments are ignored — each query in the
    function maps positionally to one _FakeQuery created by the test.
    """

    def __init__(self, stage, data=None, subquery_obj=None):
        self.stage = stage
        self._data = data or []
        self._subquery_obj = subquery_obj

    def filter(self, *args, **kwargs):
        return self

    def join(self, *args, **kwargs):
        return self

    def distinct(self):
        return self

    def __iter__(self):
        return iter(self._data)

    def all(self):
        return self._data

    def subquery(self):
        return self._subquery_obj


class _FakeSession:
    def __init__(self, queries):
        self.query_calls = 0
        self._queries = queries

    def query(self, *args, **kwargs):
        query = self._queries[self.query_calls]
        self.query_calls += 1
        return query


def _ranked_subquery():
    return SimpleNamespace(
        c=SimpleNamespace(
            work_card_id='work_card_id',
            site_id='site_id',
            employee_id='employee_id',
            review_status='review_status',
            monthly_total_hours='monthly_total_hours',
            rank='rank',
        )
    )


class LoadHoursMatrixForSitesTests(unittest.TestCase):
    def test_bulk_loader_uses_fixed_query_budget_for_many_sites(self):
        site_ids = [uuid.uuid4() for _ in range(60)]
        employees = []
        for index, site_id in enumerate(site_ids):
            employees.append(SimpleNamespace(id=uuid.uuid4(), site_id=site_id, full_name=f'B-{index}', passport_id='P2'))
            employees.append(SimpleNamespace(id=uuid.uuid4(), site_id=site_id, full_name=f'A-{index}', passport_id='P1'))

        best_cards_rows = []
        day_entries = []
        for employee in employees[:20]:
            work_card_id = uuid.uuid4()
            best_cards_rows.append(
                SimpleNamespace(
                    work_card_id=work_card_id,
                    site_id=employee.site_id,
                    employee_id=employee.id,
                    review_status='APPROVED',
                    monthly_total_hours=None,
                )
            )
            day_entries.append(SimpleNamespace(
                work_card_id=work_card_id, day_of_month=1, total_hours=8.0,
                day_status=None, attributed_site_id=None,
            ))

        # No visiting employees → the optional "missing visiting employees" query
        # is skipped, so the budget is a fixed 4 queries regardless of site count.
        fake_session = _FakeSession([
            _FakeQuery(stage='home_employees', data=employees),
            _FakeQuery(stage='visiting_ids', data=[]),
            _FakeQuery(stage='ranked_cards', subquery_obj=_ranked_subquery()),
            _FakeQuery(stage='best_cards', data=best_cards_rows),
            _FakeQuery(stage='day_entries', data=day_entries),
        ])

        with patch.object(sites_api.db, 'session', fake_session):
            results = sites_api.load_hours_matrix_for_sites(
                site_ids=site_ids,
                processing_month='2026-02-01',
                approved_only=False,
                include_inactive=True,
                business_id=uuid.uuid4(),
            )

        self.assertEqual(fake_session.query_calls, 5)
        self.assertEqual(len(results), 60)

        first_site_data = results[site_ids[0]]
        self.assertIn('employees', first_site_data)
        self.assertIn('matrix', first_site_data)
        self.assertIn('status_map', first_site_data)
        self.assertEqual(first_site_data['employees'][0].full_name, 'A-0')
        self.assertEqual(first_site_data['employees'][1].full_name, 'B-0')

    def test_day_entries_bucket_by_attributed_site(self):
        """An employee managed at site Z with days attributed to X and Y appears
        in all three sites' matrices, each with only its own days."""
        site_x, site_y, site_z = uuid.uuid4(), uuid.uuid4(), uuid.uuid4()
        employee = SimpleNamespace(id=uuid.uuid4(), site_id=site_z, full_name='Dana', passport_id='P9')
        work_card_id = uuid.uuid4()

        best_cards_rows = [SimpleNamespace(
            work_card_id=work_card_id,
            site_id=site_z,
            employee_id=employee.id,
            review_status='APPROVED',
            # A card-level monthly total must be ignored for a split employee.
            monthly_total_hours=200.0,
        )]
        day_entries = [
            SimpleNamespace(work_card_id=work_card_id, day_of_month=1, total_hours=8.0, day_status=None, attributed_site_id=site_x),
            SimpleNamespace(work_card_id=work_card_id, day_of_month=2, total_hours=7.0, day_status=None, attributed_site_id=site_y),
            SimpleNamespace(work_card_id=work_card_id, day_of_month=3, total_hours=6.0, day_status=None, attributed_site_id=None),
        ]

        fake_session = _FakeSession([
            _FakeQuery(stage='home_employees', data=[employee]),       # home of Z
            _FakeQuery(stage='visiting_ids', data=[(employee.id,)]),   # already home → no extra query
            _FakeQuery(stage='ranked_cards', subquery_obj=_ranked_subquery()),
            _FakeQuery(stage='best_cards', data=best_cards_rows),
            _FakeQuery(stage='day_entries', data=day_entries),
        ])

        with patch.object(sites_api.db, 'session', fake_session):
            results = sites_api.load_hours_matrix_for_sites(
                site_ids=[site_x, site_y, site_z],
                processing_month='2026-02-01',
                approved_only=False,
                include_inactive=True,
                business_id=uuid.uuid4(),
            )

        self.assertEqual(fake_session.query_calls, 5)
        emp = str(employee.id)

        # Each site shows only its attributed day.
        self.assertEqual(results[site_x]['matrix'][emp], {1: 8.0})
        self.assertEqual(results[site_y]['matrix'][emp], {2: 7.0})
        self.assertEqual(results[site_z]['matrix'][emp], {3: 6.0})

        # The employee surfaces as a column in every site they contributed to.
        for site_id in (site_x, site_y, site_z):
            self.assertIn(employee, results[site_id]['employees'])
            self.assertEqual(results[site_id]['status_map'][emp], 'APPROVED')

        # The card-level monthly total is suppressed for a split employee.
        self.assertEqual(results[site_z]['monthly_totals'], {})


if __name__ == '__main__':
    unittest.main()
