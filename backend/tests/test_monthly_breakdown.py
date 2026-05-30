import unittest
import uuid
from datetime import date, datetime, timedelta, timezone
from types import SimpleNamespace

from backend.app.api.work_cards import compute_monthly_breakdown_payload


def make_entry(day, hours):
    return SimpleNamespace(day_of_month=day, total_hours=hours)


def make_card(*, status, day_hours_pairs, approved_at=None, created_at, card_id=None, source='ADMIN_SINGLE'):
    return SimpleNamespace(
        id=card_id or uuid.uuid4(),
        review_status=status,
        approved_at=approved_at,
        created_at=created_at,
        source=source,
        day_entries=[make_entry(d, h) for d, h in day_hours_pairs],
    )


def make_context(card, *, employee_id=None, site_id=None, processing_month=None):
    # Build a card-like object exposing only the attributes the function reads.
    return SimpleNamespace(
        id=card.id,
        review_status=card.review_status,
        approved_at=card.approved_at,
        created_at=card.created_at,
        employee_id=employee_id or uuid.uuid4(),
        site_id=site_id or uuid.uuid4(),
        processing_month=processing_month or date(2026, 5, 1),
        source=card.source,
        day_entries=card.day_entries,
    )


class MonthlyBreakdownTests(unittest.TestCase):
    def test_single_pending_card_only(self):
        t = datetime(2026, 5, 31, 10, tzinfo=timezone.utc)
        card = make_card(
            status='NEEDS_REVIEW',
            day_hours_pairs=[(1, 8), (2, 8), (3, 8)],
            created_at=t,
        )
        ctx = make_context(card)

        payload = compute_monthly_breakdown_payload(ctx, [card])

        self.assertEqual(payload['approved_total_hours'], 0.0)
        self.assertEqual(payload['current_card_contribution_hours'], 24.0)
        self.assertEqual(payload['projected_total_hours'], 24.0)
        self.assertEqual(len(payload['cards']), 1)
        self.assertTrue(payload['cards'][0]['is_current'])

    def test_two_non_overlapping_cards_one_approved(self):
        t1 = datetime(2026, 5, 25, 10, tzinfo=timezone.utc)
        t2 = datetime(2026, 5, 31, 10, tzinfo=timezone.utc)
        approved = make_card(
            status='APPROVED',
            day_hours_pairs=[(d, 8) for d in range(1, 18)],  # days 1-17 = 136h
            approved_at=t1,
            created_at=t1 - timedelta(hours=1),
        )
        pending = make_card(
            status='NEEDS_REVIEW',
            day_hours_pairs=[(d, 10) for d in range(18, 25)],  # days 18-24 = 70h
            created_at=t2,
        )
        ctx = make_context(pending)

        payload = compute_monthly_breakdown_payload(ctx, [approved, pending])

        self.assertEqual(payload['approved_total_hours'], 136.0)
        self.assertEqual(payload['current_card_contribution_hours'], 70.0)
        self.assertEqual(payload['projected_total_hours'], 206.0)
        self.assertEqual(len(payload['cards']), 2)
        self.assertEqual(payload['cards'][0]['review_status'], 'APPROVED')
        self.assertEqual(payload['cards'][0]['is_current'], False)
        self.assertEqual(payload['cards'][1]['is_current'], True)

    def test_overlapping_day_is_attributed_to_earlier_approved_card(self):
        t1 = datetime(2026, 5, 25, 10, tzinfo=timezone.utc)
        t2 = datetime(2026, 5, 31, 10, tzinfo=timezone.utc)
        # Approved card has days 1-25, with day 25 = 8h
        approved = make_card(
            status='APPROVED',
            day_hours_pairs=[(d, 8) for d in range(1, 26)],  # 200h
            approved_at=t1,
            created_at=t1 - timedelta(hours=1),
        )
        # Pending card has day 25 (overlap, 12h) + days 26-31 (6h each = 36h)
        pending = make_card(
            status='NEEDS_REVIEW',
            day_hours_pairs=[(25, 12)] + [(d, 6) for d in range(26, 32)],
            created_at=t2,
        )
        ctx = make_context(pending)

        payload = compute_monthly_breakdown_payload(ctx, [approved, pending])

        # Day 25 attributed to approved card (8h, not pending's 12h)
        self.assertEqual(payload['approved_total_hours'], 200.0)
        # Pending contribution is only days 26-31 (6 days * 6h = 36h)
        self.assertEqual(payload['current_card_contribution_hours'], 36.0)
        self.assertEqual(payload['projected_total_hours'], 236.0)

    def test_current_card_already_approved_projected_equals_approved_total(self):
        t1 = datetime(2026, 5, 25, 10, tzinfo=timezone.utc)
        t2 = datetime(2026, 5, 31, 10, tzinfo=timezone.utc)
        first = make_card(
            status='APPROVED',
            day_hours_pairs=[(d, 8) for d in range(1, 18)],
            approved_at=t1,
            created_at=t1 - timedelta(hours=1),
        )
        second = make_card(
            status='APPROVED',
            day_hours_pairs=[(d, 10) for d in range(18, 25)],
            approved_at=t2,
            created_at=t2 - timedelta(hours=1),
        )
        ctx = make_context(second)

        payload = compute_monthly_breakdown_payload(ctx, [first, second])

        self.assertEqual(payload['approved_total_hours'], 136.0 + 70.0)
        self.assertEqual(payload['projected_total_hours'], 136.0 + 70.0)

    def test_null_hours_entries_are_ignored(self):
        t = datetime(2026, 5, 31, 10, tzinfo=timezone.utc)
        card = make_card(
            status='NEEDS_REVIEW',
            day_hours_pairs=[(1, 8), (2, None), (3, 8)],
            created_at=t,
        )
        ctx = make_context(card)
        payload = compute_monthly_breakdown_payload(ctx, [card])
        self.assertEqual(payload['current_card_contribution_hours'], 16.0)


if __name__ == '__main__':
    unittest.main()
