import unittest
from datetime import time
from types import SimpleNamespace

from backend.app.api.work_cards import _resolve_conflict_day


def entry(total_hours, source='EXTRACTED', from_time=None, to_time=None, day_status=None):
    return SimpleNamespace(
        total_hours=total_hours,
        source=source,
        from_time=from_time,
        to_time=to_time,
        day_status=day_status,
    )


class ResolveConflictDayTests(unittest.TestCase):
    def test_identical_values_are_left_untouched(self):
        outcome = _resolve_conflict_day(
            entry(10), entry(10), previous_status='APPROVED', day_in_override_days=False
        )
        self.assertEqual(outcome, 'noop')

    def test_missing_latest_entry_carries_previous_forward(self):
        outcome = _resolve_conflict_day(
            None, entry(10), previous_status='APPROVED', day_in_override_days=False
        )
        self.assertEqual(outcome, 'carry_forward')

    def test_latest_wins_when_previous_not_approved(self):
        outcome = _resolve_conflict_day(
            entry(11), entry(10), previous_status='NEEDS_REVIEW', day_in_override_days=False
        )
        self.assertEqual(outcome, 'take_latest')

    def test_explicit_override_flag_keeps_latest_over_approved_previous(self):
        outcome = _resolve_conflict_day(
            entry(11), entry(10), previous_status='APPROVED', day_in_override_days=True
        )
        self.assertEqual(outcome, 'take_latest')

    def test_default_keeps_approved_previous_when_no_override_intent(self):
        # An extracted/carried entry that simply differs (no manual intent) still
        # defers to the approved previous value.
        outcome = _resolve_conflict_day(
            entry(11, source='EXTRACTED'),
            entry(10),
            previous_status='APPROVED',
            day_in_override_days=False,
        )
        self.assertEqual(outcome, 'take_previous')

    def test_manual_override_edit_survives_approval_without_override_flag(self):
        # Regression: a deliberate edit (source=MANUAL_OVERRIDE) to a day that an
        # approved sibling card also covers must NOT be reverted on approve, even
        # when the request carries no per-day override flag (e.g. approved after a
        # reload dropped the in-memory unlock state).
        outcome = _resolve_conflict_day(
            entry(11, source='MANUAL_OVERRIDE'),
            entry(10),
            previous_status='APPROVED',
            day_in_override_days=False,
        )
        self.assertEqual(outcome, 'take_latest')


if __name__ == '__main__':
    unittest.main()
