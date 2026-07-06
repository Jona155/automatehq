import unittest
from types import SimpleNamespace

from backend.app.api.work_cards import _approve_day_outcome, _entry_has_data


def entry(total_hours=None, source='EXTRACTED', from_time=None, to_time=None, day_status=None):
    return SimpleNamespace(
        total_hours=total_hours,
        source=source,
        from_time=from_time,
        to_time=to_time,
        day_status=day_status,
    )


class ApproveDayOutcomeTests(unittest.TestCase):
    """The per-day decision when approving consolidates a sibling card in.

    The model: the reviewed table is the truth. A human-saved value (any
    source other than EXTRACTED) always wins — including a day cleared to empty.
    Automatic extraction never overwrites an approved day. A day this card lacks
    is carried in so the approved card holds the full month.
    """

    def test_missing_current_entry_carries_sibling_in(self):
        self.assertEqual(
            _approve_day_outcome(None, sibling_is_approved=True), 'carry_in'
        )
        self.assertEqual(
            _approve_day_outcome(None, sibling_is_approved=False), 'carry_in'
        )

    def test_extraction_defers_to_approved_sibling(self):
        # A machine-written value must not overwrite an approved day.
        self.assertEqual(
            _approve_day_outcome(entry(source='EXTRACTED'), sibling_is_approved=True),
            'keep_approved',
        )

    def test_extraction_wins_over_unapproved_sibling(self):
        self.assertEqual(
            _approve_day_outcome(entry(source='EXTRACTED'), sibling_is_approved=False),
            'keep_current',
        )

    def test_human_edit_wins_even_over_approved_sibling(self):
        # The core fix: a value the admin saved is authoritative and survives
        # approval, so it is never reverted to the approved sibling's value.
        self.assertEqual(
            _approve_day_outcome(entry(source='MANUAL'), sibling_is_approved=True),
            'keep_current',
        )

    def test_cleared_day_survives_approval(self):
        # Regression for the phantom-hours bug: clearing a day (a MANUAL entry
        # with no content) must win over an approved sibling — approval must NOT
        # resurrect the sibling's hours onto the cleared day.
        cleared = entry(source='MANUAL', total_hours=None, from_time=None, to_time=None)
        self.assertFalse(_entry_has_data(cleared))
        self.assertEqual(
            _approve_day_outcome(cleared, sibling_is_approved=True), 'keep_current'
        )


class EntryHasDataTests(unittest.TestCase):
    def test_empty_entry_has_no_data(self):
        self.assertFalse(_entry_has_data(entry()))
        self.assertFalse(_entry_has_data(None))

    def test_entry_with_hours_or_status_has_data(self):
        self.assertTrue(_entry_has_data(entry(total_hours=8)))
        self.assertTrue(_entry_has_data(entry(day_status='VACATION')))
        self.assertTrue(_entry_has_data(entry(from_time='09:00')))


if __name__ == '__main__':
    unittest.main()
