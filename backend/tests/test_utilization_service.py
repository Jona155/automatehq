import unittest
import uuid
from datetime import date

from dotenv import load_dotenv

load_dotenv()

from backend.app import create_app, db
from backend.app.constants import (
    MONTHLY_TARGET_HOURS,
    BAND_HIGH,
    BAND_MID,
    BAND_LOW,
    classify_band,
)
from backend.app.models.business import Business
from backend.app.models.sites import Site, Employee
from backend.app.models.users import User
from backend.app.models.work_cards import WorkCard, WorkCardDayEntry
from backend.app.services.utilization_service import compute_utilization

MONTH = '2026-05-01'
MONTH_DATE = date(2026, 5, 1)


class BandClassificationTests(unittest.TestCase):
    """Pure helper — boundaries must be unambiguous (no DB needed)."""

    def test_high_boundary(self):
        self.assertEqual(classify_band(90), BAND_HIGH)
        self.assertEqual(classify_band(100), BAND_HIGH)
        self.assertEqual(classify_band(89.99), BAND_MID)

    def test_mid_boundary(self):
        self.assertEqual(classify_band(70), BAND_MID)
        self.assertEqual(classify_band(89), BAND_MID)
        self.assertEqual(classify_band(69.99), BAND_LOW)

    def test_low(self):
        self.assertEqual(classify_band(0), BAND_LOW)


class UtilizationServiceTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.ctx = self.app.app_context()
        self.ctx.push()

        suffix = uuid.uuid4().hex[:8]
        self.business = Business(name=f'Biz {suffix}', code=f'biz{suffix}', is_active=True)
        db.session.add(self.business)
        db.session.flush()

        self.user = User(
            business_id=self.business.id,
            full_name='Admin Tester',
            email=f'admin_{suffix}@example.com',
            role='ADMIN',
        )
        db.session.add(self.user)
        db.session.flush()

        self.site_a = Site(business_id=self.business.id, site_name=f'SiteA {suffix}', site_code='A1', is_active=True)
        self.site_b = Site(business_id=self.business.id, site_name=f'SiteB {suffix}', site_code='B1', is_active=True)
        db.session.add_all([self.site_a, self.site_b])
        db.session.flush()

        self.emp_a = Employee(business_id=self.business.id, site_id=self.site_a.id,
                              full_name='Emp A', passport_id=f'PA{suffix}', is_active=True)
        self.emp_b = Employee(business_id=self.business.id, site_id=self.site_b.id,
                              full_name='Emp B', passport_id=f'PB{suffix}', is_active=True)
        db.session.add_all([self.emp_a, self.emp_b])
        db.session.commit()

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

    # ---- helpers -------------------------------------------------------
    def _add_card(self, employee, site, review_status='APPROVED', monthly_total=None):
        card = WorkCard(
            business_id=self.business.id,
            site_id=site.id,
            employee_id=employee.id,
            processing_month=MONTH_DATE,
            source='EXTRACTED',
            review_status=review_status,
            monthly_total_hours=monthly_total,
        )
        db.session.add(card)
        db.session.flush()
        return card

    def _add_day(self, card, day, hours, attributed_site=None):
        db.session.add(WorkCardDayEntry(
            work_card_id=card.id,
            day_of_month=day,
            total_hours=hours,
            attributed_site_id=(attributed_site.id if attributed_site else None),
            source='EXTRACTED',
            is_valid=True,
        ))

    def _compute(self):
        return compute_utilization(self.business.id, MONTH)['employees']

    def _emp(self, result, employee):
        return result[str(employee.id)]

    # ---- tests ---------------------------------------------------------
    def test_single_site_day_sum(self):
        card = self._add_card(self.emp_a, self.site_a)
        self._add_day(card, 1, 10)
        self._add_day(card, 2, 8)
        db.session.commit()

        row = self._emp(self._compute(), self.emp_a)
        self.assertEqual(row['hours'], 18.0)
        self.assertEqual(row['per_site'], {str(self.site_a.id): 18.0})
        self.assertAlmostEqual(row['utilization_pct'], 18.0 / MONTHLY_TARGET_HOURS * 100)

    def test_multi_site_split_headline_is_total(self):
        # One managing card at site A; day 2 attributed to site B.
        card = self._add_card(self.emp_a, self.site_a)
        self._add_day(card, 1, 10)                              # -> site A
        self._add_day(card, 2, 6, attributed_site=self.site_b)  # -> site B
        db.session.commit()

        row = self._emp(self._compute(), self.emp_a)
        self.assertEqual(row['hours'], 16.0)  # headline = total across sites
        self.assertEqual(row['per_site'], {
            str(self.site_a.id): 10.0,
            str(self.site_b.id): 6.0,
        })

    def test_monthly_total_fallback(self):
        # Card with no per-day entries -> monthly_total_hours is used.
        self._add_card(self.emp_a, self.site_a, monthly_total=100)
        db.session.commit()

        row = self._emp(self._compute(), self.emp_a)
        self.assertEqual(row['hours'], 100.0)
        self.assertEqual(row['per_site'], {str(self.site_a.id): 100.0})

    def test_day_entries_win_over_monthly_total(self):
        # When both exist, per-day hours are authoritative (no double count).
        card = self._add_card(self.emp_a, self.site_a, monthly_total=999)
        self._add_day(card, 1, 12)
        db.session.commit()

        row = self._emp(self._compute(), self.emp_a)
        self.assertEqual(row['hours'], 12.0)

    def test_zero_hours_employee_is_low(self):
        # emp_b has no card at all this month -> 0 hours, LOW band.
        db.session.commit()

        row = self._emp(self._compute(), self.emp_b)
        self.assertEqual(row['hours'], 0.0)
        self.assertEqual(row['utilization_pct'], 0.0)
        self.assertEqual(row['band'], BAND_LOW)

    def test_over_100_percent(self):
        card = self._add_card(self.emp_a, self.site_a)
        for day in range(1, 13):  # 12 days * 20h = 240h > 236
            self._add_day(card, day, 20)
        db.session.commit()

        row = self._emp(self._compute(), self.emp_a)
        self.assertEqual(row['hours'], 240.0)
        self.assertGreater(row['utilization_pct'], 100.0)
        self.assertEqual(row['band'], BAND_HIGH)


if __name__ == '__main__':
    unittest.main()
