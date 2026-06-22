import unittest
from datetime import datetime

from backend.app.api.work_cards import _sibling_entry_outranks


def candidate(is_approved, created_at):
    return {'is_approved': is_approved, 'created_at': created_at}


class SiblingOutranksTests(unittest.TestCase):
    """Per-day precedence when folding multiple sibling cards into one snapshot:
    an APPROVED card (locked source of truth) beats a non-approved one; within
    the same approval tier the latest card wins."""

    def test_approved_beats_pending_regardless_of_date(self):
        approved_old = candidate(True, datetime(2024, 1, 1))
        pending_new = candidate(False, datetime(2024, 6, 1))
        # An approved (older) candidate should outrank a newer pending existing.
        self.assertTrue(_sibling_entry_outranks(approved_old, pending_new))
        # And a pending (newer) candidate must NOT outrank an approved existing.
        self.assertFalse(_sibling_entry_outranks(pending_new, approved_old))

    def test_latest_wins_within_same_tier(self):
        newer = candidate(False, datetime(2024, 6, 2))
        older = candidate(False, datetime(2024, 6, 1))
        self.assertTrue(_sibling_entry_outranks(newer, older))
        self.assertFalse(_sibling_entry_outranks(older, newer))

    def test_latest_wins_within_approved_tier(self):
        newer = candidate(True, datetime(2024, 6, 2))
        older = candidate(True, datetime(2024, 6, 1))
        self.assertTrue(_sibling_entry_outranks(newer, older))

    def test_missing_dates_do_not_outrank(self):
        a = candidate(False, None)
        b = candidate(False, datetime(2024, 6, 1))
        self.assertFalse(_sibling_entry_outranks(a, b))


if __name__ == '__main__':
    unittest.main()
