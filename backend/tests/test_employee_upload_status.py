import unittest
import uuid
from unittest.mock import patch

from flask import g

from backend.app import create_app
from backend.app.api import sites
from backend.app.models.sites import Employee
from backend.app.services.sites.hours_matrix_service import build_employee_upload_status_map


class EmployeeUploadStatusTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.business_id = uuid.uuid4()
        self.site_id = uuid.uuid4()

    def _employee(self, name):
        return Employee(
            id=uuid.uuid4(),
            business_id=self.business_id,
            site_id=self.site_id,
            full_name=name,
            passport_id=f'P-{name}',
            is_active=True,
        )

    def test_build_employee_upload_status_map_regressions(self):
        no_cards = self._employee('no-cards')
        no_extraction = self._employee('no-extraction')
        failed = self._employee('failed')
        pending = self._employee('pending')
        approved_done = self._employee('approved-done')
        extracted_done = self._employee('extracted-done')

        rows = [
            (no_cards, None, None, None),
            (no_extraction, uuid.uuid4(), 'NEEDS_REVIEW', None),
            (failed, uuid.uuid4(), 'NEEDS_REVIEW', 'FAILED'),
            (pending, uuid.uuid4(), 'NEEDS_REVIEW', 'RUNNING'),
            (approved_done, uuid.uuid4(), 'APPROVED', 'DONE'),
            (extracted_done, uuid.uuid4(), 'NEEDS_REVIEW', 'DONE'),
        ]

        status_map = build_employee_upload_status_map(rows)

        self.assertEqual(status_map[str(no_cards.id)]['status'], 'NO_UPLOAD')
        self.assertIsNone(status_map[str(no_cards.id)]['work_card_id'])
        self.assertEqual(status_map[str(no_extraction.id)]['status'], 'PENDING')
        self.assertEqual(status_map[str(failed.id)]['status'], 'FAILED')
        self.assertEqual(status_map[str(pending.id)]['status'], 'PENDING')
        self.assertEqual(status_map[str(approved_done.id)]['status'], 'APPROVED')
        self.assertEqual(status_map[str(extracted_done.id)]['status'], 'EXTRACTED')

    @patch('backend.app.api.sites.get_latest_work_card_with_extraction_by_employee')
    @patch('backend.app.api.sites.repo.get_by_id')
    def test_get_employee_upload_status_consumes_batched_results(self, mock_get_site, mock_get_batched):
        employees = [
            self._employee('no-cards'),
            self._employee('no-extraction'),
            self._employee('failed'),
            self._employee('pending'),
            self._employee('approved-done'),
            self._employee('extracted-done'),
        ]
        work_card_ids = [uuid.uuid4() for _ in range(5)]

        mock_get_site.return_value = type('SiteStub', (), {'business_id': self.business_id})()
        mock_get_batched.return_value = [
            (employees[0], None, None, None),
            (employees[1], work_card_ids[0], 'NEEDS_REVIEW', None),
            (employees[2], work_card_ids[1], 'NEEDS_REVIEW', 'FAILED'),
            (employees[3], work_card_ids[2], 'NEEDS_REVIEW', 'PENDING'),
            (employees[4], work_card_ids[3], 'APPROVED', 'DONE'),
            (employees[5], work_card_ids[4], 'NEEDS_REVIEW', 'DONE'),
        ]

        with self.app.test_request_context(
            f'/api/sites/{self.site_id}/employee-upload-status?processing_month=2025-01-01'
        ):
            g.business_id = self.business_id
            response, status_code = sites.get_employee_upload_status.__wrapped__(self.site_id)

        self.assertEqual(status_code, 200)
        payload = response.get_json()
        self.assertTrue(payload['success'])

        got = {item['employee']['full_name']: item for item in payload['data']}
        self.assertEqual(got['no-cards']['status'], 'NO_UPLOAD')
        self.assertIsNone(got['no-cards']['work_card_id'])
        self.assertEqual(got['no-extraction']['status'], 'PENDING')
        self.assertEqual(got['failed']['status'], 'FAILED')
        self.assertEqual(got['pending']['status'], 'PENDING')
        self.assertEqual(got['approved-done']['status'], 'APPROVED')
        self.assertEqual(got['extracted-done']['status'], 'EXTRACTED')

        mock_get_batched.assert_called_once_with(
            business_id=self.business_id,
            site_id=self.site_id,
            processing_month=sites.datetime(2025, 1, 1).date(),
        )


if __name__ == '__main__':
    unittest.main()
