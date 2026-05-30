import unittest
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

from backend.app.api.work_cards import unapprove_card_on_edit


def make_card(status, approved_at=None, approved_by_user_id=None):
    return SimpleNamespace(
        id=uuid.uuid4(),
        review_status=status,
        approved_at=approved_at,
        approved_by_user_id=approved_by_user_id,
    )


class UnapproveCardOnEditTests(unittest.TestCase):
    def test_approved_card_flips_to_needs_review_when_entries_change(self):
        approver = uuid.uuid4()
        card = make_card(
            status='APPROVED',
            approved_at=datetime(2026, 5, 25, tzinfo=timezone.utc),
            approved_by_user_id=approver,
        )

        flipped = unapprove_card_on_edit(card, had_any_change=True)

        self.assertTrue(flipped)
        self.assertEqual(card.review_status, 'NEEDS_REVIEW')
        self.assertIsNone(card.approved_at)
        self.assertIsNone(card.approved_by_user_id)

    def test_approved_card_stays_approved_when_no_changes(self):
        approver = uuid.uuid4()
        approved_at = datetime(2026, 5, 25, tzinfo=timezone.utc)
        card = make_card(
            status='APPROVED',
            approved_at=approved_at,
            approved_by_user_id=approver,
        )

        flipped = unapprove_card_on_edit(card, had_any_change=False)

        self.assertFalse(flipped)
        self.assertEqual(card.review_status, 'APPROVED')
        self.assertEqual(card.approved_at, approved_at)
        self.assertEqual(card.approved_by_user_id, approver)

    def test_pending_card_is_untouched_even_when_entries_change(self):
        card = make_card(status='NEEDS_REVIEW')

        flipped = unapprove_card_on_edit(card, had_any_change=True)

        self.assertFalse(flipped)
        self.assertEqual(card.review_status, 'NEEDS_REVIEW')

    def test_rejected_card_is_untouched(self):
        card = make_card(status='REJECTED')

        flipped = unapprove_card_on_edit(card, had_any_change=True)

        self.assertFalse(flipped)
        self.assertEqual(card.review_status, 'REJECTED')


if __name__ == '__main__':
    unittest.main()
