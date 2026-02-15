import os
import unittest
from datetime import date

from backend.app import create_app, db
from backend.app.auth_utils import encode_auth_token
from backend.app.models.business import Business
from backend.app.models.sites import Employee, Site
from backend.app.models.users import User
from backend.app.models.work_cards import WorkCard, WorkCardDayEntry
from backend.app.observability import QueryCounter


class TestSitesQueryBudget(unittest.TestCase):
    MATRIX_QUERY_BUDGET = 12
    SUMMARY_BATCH_QUERY_BUDGET = 20
    SALARY_BATCH_QUERY_BUDGET = 20

    def setUp(self):
        os.environ.setdefault('JWT_SECRET_KEY', 'test-secret')

        self.app = create_app()
        self.client = self.app.test_client()
        self.app_context = self.app.app_context()
        self.app_context.push()

        self.business = Business(name='Perf Budget Test', code='perf-budget-test')
        db.session.add(self.business)
        db.session.flush()

        self.user = User(
            business_id=self.business.id,
            full_name='Perf User',
            email='perf-budget@example.com',
            role='ADMIN',
            password_hash='n/a',
            is_active=True,
        )
        db.session.add(self.user)
        db.session.flush()

        self.site = Site(
            business_id=self.business.id,
            site_name='Perf Site',
            site_code='PERF',
            is_active=True,
        )
        db.session.add(self.site)
        db.session.flush()

        self.employee = Employee(
            business_id=self.business.id,
            site_id=self.site.id,
            full_name='Perf Employee',
            passport_id='P1234567',
            is_active=True,
        )
        db.session.add(self.employee)
        db.session.flush()

        self.work_card = WorkCard(
            business_id=self.business.id,
            site_id=self.site.id,
            employee_id=self.employee.id,
            processing_month=date(2026, 2, 1),
            source='ADMIN_SINGLE',
            original_filename='perf.jpg',
            mime_type='image/jpeg',
            file_size_bytes=128,
            review_status='APPROVED',
        )
        db.session.add(self.work_card)
        db.session.flush()

        db.session.add(
            WorkCardDayEntry(
                work_card_id=self.work_card.id,
                day_of_month=1,
                total_hours=8,
                source='EXTRACTED',
                is_valid=True,
            )
        )
        db.session.commit()

        token = encode_auth_token(self.user.id)
        self.headers = {'Authorization': f'Bearer {token}'}

    def tearDown(self):
        db.session.query(WorkCardDayEntry).filter_by(work_card_id=self.work_card.id).delete()
        db.session.query(WorkCard).filter_by(id=self.work_card.id).delete()
        db.session.query(Employee).filter_by(id=self.employee.id).delete()
        db.session.query(Site).filter_by(id=self.site.id).delete()
        db.session.query(User).filter_by(id=self.user.id).delete()
        db.session.query(Business).filter_by(id=self.business.id).delete()
        db.session.commit()
        self.app_context.pop()

    def _get_with_query_count(self, path: str):
        with QueryCounter(db.engine) as counter:
            response = self.client.get(path, headers=self.headers)
        return response, counter.count

    def test_matrix_endpoint_query_budget(self):
        response, query_count = self._get_with_query_count(
            f'/api/sites/{self.site.id}/matrix?processing_month=2026-02-01'
        )
        self.assertEqual(response.status_code, 200)
        self.assertLessEqual(
            query_count,
            self.MATRIX_QUERY_BUDGET,
            f'Matrix endpoint exceeded query budget: {query_count} > {self.MATRIX_QUERY_BUDGET}',
        )

    def test_summary_export_batch_query_budget(self):
        response, query_count = self._get_with_query_count(
            '/api/sites/summary/export-batch?processing_month=2026-02-01'
        )
        self.assertEqual(response.status_code, 200)
        self.assertLessEqual(
            query_count,
            self.SUMMARY_BATCH_QUERY_BUDGET,
            f'Summary export batch exceeded query budget: {query_count} > {self.SUMMARY_BATCH_QUERY_BUDGET}',
        )

    def test_salary_template_export_batch_query_budget(self):
        response, query_count = self._get_with_query_count(
            '/api/sites/salary-template/export-batch?processing_month=2026-02-01'
        )
        self.assertEqual(response.status_code, 200)
        self.assertLessEqual(
            query_count,
            self.SALARY_BATCH_QUERY_BUDGET,
            f'Salary template export batch exceeded query budget: {query_count} > {self.SALARY_BATCH_QUERY_BUDGET}',
        )


if __name__ == '__main__':
    unittest.main()
