import unittest
from datetime import date
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

from backend.app.services.sites.access_link_service import AccessLinkService
from backend.app.services.sites.hours_matrix_service import HoursMatrixService


class TestHoursMatrixService(unittest.TestCase):
    def test_sort_employees_for_export(self):
        service = HoursMatrixService(MagicMock(), MagicMock(), MagicMock())
        employees = [
            SimpleNamespace(id='2', full_name='b', passport_id='2'),
            SimpleNamespace(id='1', full_name='a', passport_id='3'),
            SimpleNamespace(id='3', full_name='a', passport_id='1'),
        ]
        sorted_employees = service.sort_employees_for_export(employees)
        self.assertEqual([e.id for e in sorted_employees], ['3', '1', '2'])

    def test_get_employee_upload_status(self):
        employee_repo = MagicMock()
        work_card_repo = MagicMock()
        extraction_repo = MagicMock()
        service = HoursMatrixService(employee_repo, work_card_repo, extraction_repo)

        employee = SimpleNamespace(id='emp-1')
        card = SimpleNamespace(id='wc-1', review_status='APPROVED')
        extraction = SimpleNamespace(status='DONE')

        employee_repo.get_by_site.return_value = [employee]
        work_card_repo.get_by_employee_month.return_value = [card]
        extraction_repo.get_by_work_card.return_value = extraction

        result = service.get_employee_upload_status('site', 'biz', '2026-01-01')
        self.assertEqual(result[0]['status'], 'APPROVED')
        self.assertEqual(result[0]['work_card_id'], 'wc-1')


class TestAccessLinkService(unittest.TestCase):
    def setUp(self):
        self.access_repo = MagicMock()
        self.service = AccessLinkService(
            access_repo=self.access_repo,
            employee_repo=MagicMock(),
            site_repo=MagicMock(),
            twilio_client_factory=MagicMock(),
            host_url_builder=lambda: 'http://localhost:5000/',
        )

    @patch('backend.app.services.sites.access_link_service.secrets.token_urlsafe')
    def test_generate_access_token(self, mock_token):
        mock_token.side_effect = ['taken', 'free']
        self.access_repo.token_exists.side_effect = [True, False]
        self.assertEqual(self.service.generate_access_token(), 'free')

    def test_compose_message(self):
        msg = self.service.compose_message('John', date(2026, 1, 1), 'http://x')
        self.assertIn('John', msg)
        self.assertIn('01/2026', msg)


if __name__ == '__main__':
    unittest.main()
