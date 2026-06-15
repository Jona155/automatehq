"""Unit tests for WhatsApp month-cutoff assignment (processing_month_for_upload)."""
import os
import sys
from datetime import date

sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..'))

from whatsapp_poller import processing_month_for_upload


def test_on_cutoff_day_goes_to_previous_month():
    # cutoff 10, uploaded on the 10th (inclusive) → previous month
    assert processing_month_for_upload(date(2026, 6, 10), 10) == date(2026, 5, 1)


def test_before_cutoff_goes_to_previous_month():
    assert processing_month_for_upload(date(2026, 6, 1), 10) == date(2026, 5, 1)
    assert processing_month_for_upload(date(2026, 6, 5), 10) == date(2026, 5, 1)


def test_after_cutoff_goes_to_current_month():
    assert processing_month_for_upload(date(2026, 6, 11), 10) == date(2026, 6, 1)
    assert processing_month_for_upload(date(2026, 6, 30), 10) == date(2026, 6, 1)


def test_january_wraps_to_previous_december():
    # uploaded Jan 5 with cutoff 10 → previous month is Dec of the prior year
    assert processing_month_for_upload(date(2026, 1, 5), 10) == date(2025, 12, 1)


def test_january_after_cutoff_stays_january():
    assert processing_month_for_upload(date(2026, 1, 20), 10) == date(2026, 1, 1)


def test_cutoff_31_always_previous_month():
    assert processing_month_for_upload(date(2026, 6, 30), 31) == date(2026, 5, 1)
    assert processing_month_for_upload(date(2026, 6, 1), 31) == date(2026, 5, 1)


def test_cutoff_1_only_first_day_previous():
    assert processing_month_for_upload(date(2026, 6, 1), 1) == date(2026, 5, 1)
    assert processing_month_for_upload(date(2026, 6, 2), 1) == date(2026, 6, 1)
