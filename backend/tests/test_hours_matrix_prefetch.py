import unittest
import uuid
from types import SimpleNamespace
from unittest.mock import patch

from backend.app.api import sites as sites_api


class _FakeQuery:
    def __init__(self, stage, data=None, subquery_obj=None):
        self.stage = stage
        self._data = data or []
        self._subquery_obj = subquery_obj

    def filter(self, *args, **kwargs):
        return self

    def all(self):
        return self._data

    def subquery(self):
        return self._subquery_obj


class _FakeSession:
    def __init__(self, employees, best_cards_rows, day_entries):
        self.query_calls = 0
        ranked_subquery = SimpleNamespace(
            c=SimpleNamespace(
                work_card_id='work_card_id',
                site_id='site_id',
                employee_id='employee_id',
                review_status='review_status',
                rank='rank',
            )
        )
        self._queries = [
            _FakeQuery(stage='employees', data=employees),
            _FakeQuery(stage='ranked_cards', subquery_obj=ranked_subquery),
            _FakeQuery(stage='best_cards', data=best_cards_rows),
            _FakeQuery(stage='day_entries', data=day_entries),
        ]

    def query(self, *args, **kwargs):
        query = self._queries[self.query_calls]
        self.query_calls += 1
        return query


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
                )
            )
            day_entries.append(SimpleNamespace(work_card_id=work_card_id, day_of_month=1, total_hours=8.0))

        fake_session = _FakeSession(employees, best_cards_rows, day_entries)

        with patch.object(sites_api.db, 'session', fake_session):
            results = sites_api.load_hours_matrix_for_sites(
                site_ids=site_ids,
                processing_month='2026-02-01',
                approved_only=False,
                include_inactive=True,
                business_id=uuid.uuid4(),
            )

        self.assertEqual(fake_session.query_calls, 4)
        self.assertEqual(len(results), 60)

        first_site_data = results[site_ids[0]]
        self.assertIn('employees', first_site_data)
        self.assertIn('matrix', first_site_data)
        self.assertIn('status_map', first_site_data)
        self.assertEqual(first_site_data['employees'][0].full_name, 'A-0')
        self.assertEqual(first_site_data['employees'][1].full_name, 'B-0')


if __name__ == '__main__':
    unittest.main()
