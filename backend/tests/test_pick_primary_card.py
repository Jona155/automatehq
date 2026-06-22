import unittest
from types import SimpleNamespace

from backend.app.api.work_cards import _pick_primary_card


def card(card_id, status):
    return SimpleNamespace(id=card_id, review_status=status)


class PickPrimaryCardTests(unittest.TestCase):
    """The primary card owns the editable employee-month table. Input is the
    group's cards sorted newest-first (as get_group_cards returns)."""

    def test_no_cards_returns_none(self):
        self.assertIsNone(_pick_primary_card([]))

    def test_single_card_is_primary(self):
        c = card('a', 'NEEDS_REVIEW')
        self.assertIs(_pick_primary_card([c]), c)

    def test_latest_pending_wins_over_approved(self):
        # Newest-first: an approved card sits ahead of an older pending one, but
        # the still-being-reviewed (pending) card must own the table.
        approved_new = card('new', 'APPROVED')
        pending_old = card('old', 'NEEDS_REVIEW')
        self.assertIs(_pick_primary_card([approved_new, pending_old]), pending_old)

    def test_newest_pending_wins_when_multiple_pending(self):
        pending_new = card('new', 'NEEDS_REVIEW')
        pending_old = card('old', 'NEEDS_ASSIGNMENT')
        self.assertIs(_pick_primary_card([pending_new, pending_old]), pending_new)

    def test_all_approved_falls_back_to_newest(self):
        approved_new = card('new', 'APPROVED')
        approved_old = card('old', 'APPROVED')
        self.assertIs(_pick_primary_card([approved_new, approved_old]), approved_new)


if __name__ == '__main__':
    unittest.main()
