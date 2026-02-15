import unittest
import uuid
from datetime import date

from backend.app import create_app, db
from backend.app.services.hours_matrix_service import (
    build_hours_matrix_query,
    build_matrix_and_status_map,
)


class HoursMatrixServiceTests(unittest.TestCase):
    def test_build_matrix_and_status_map_handles_duplicates_null_totals_and_precedence(self):
        employee_a = uuid.uuid4()
        employee_b = uuid.uuid4()

        rows = [
            # Duplicate-card-style rows for employee_a where approved should win in status_map
            (employee_a, 'NEEDS_REVIEW', 1, 8),
            (employee_a, 'APPROVED', 1, 8.5),
            (employee_a, 'APPROVED', 2, None),  # null total_hours should be ignored
            # Employee_b has no day entry (outer join row), should only appear in status_map
            (employee_b, 'REJECTED', None, None),
        ]

        matrix, status_map = build_matrix_and_status_map(rows)

        self.assertEqual(status_map[str(employee_a)], 'APPROVED')
        self.assertEqual(status_map[str(employee_b)], 'REJECTED')

        self.assertEqual(matrix[str(employee_a)][1], 8.5)
        self.assertNotIn(2, matrix[str(employee_a)])
        self.assertNotIn(str(employee_b), matrix)

    def test_build_matrix_and_status_map_with_missing_employees_returns_empty(self):
        matrix, status_map = build_matrix_and_status_map([])
        self.assertEqual(matrix, {})
        self.assertEqual(status_map, {})

    def test_build_hours_matrix_query_applies_approved_only_in_cte(self):
        app = create_app()
        with app.app_context():
            query = build_hours_matrix_query(
                session=db.session,
                business_id=uuid.uuid4(),
                site_id=uuid.uuid4(),
                processing_month=date(2026, 1, 1),
                approved_only=True,
            )
            sql = str(query.statement.compile(compile_kwargs={'literal_binds': True}))

        self.assertIn('WITH ranked_cards AS', sql)
        self.assertIn('selected_cards AS', sql)
        self.assertIn("work_cards.review_status = 'APPROVED'", sql)
        self.assertIn('LEFT OUTER JOIN work_card_day_entries', sql)


if __name__ == '__main__':
    unittest.main()
