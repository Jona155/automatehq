import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from extractor import (
    PassportIdCandidate,
    SinglePassExtraction,
    WorkRow,
    _apply_semantic_gating,
    _build_result_from_single_pass,
)


def test_single_pass_build_includes_normalized_candidates():
    extraction = SinglePassExtraction(
        employee_name="John",
        passport_id_candidates=[
            PassportIdCandidate(raw="N-123456", normalized=None, source_region="header", confidence=0.9),
            PassportIdCandidate(raw="bad", normalized=None, source_region="footer", confidence=0.2),
        ],
        selected_passport_id_normalized=None,
        entries=[
            WorkRow(day=1, start_time="08:00", end_time="17:00", total_hours=9),
        ],
    )

    result = _build_result_from_single_pass(extraction)
    assert result["extracted_passport_id"] == "N123456"
    assert result["normalized_passport_candidates"] == ["N123456"]


def test_off_mark_row_is_forced_empty_without_time_pair():
    entries, quality = _apply_semantic_gating([
        {
            "day": 7,
            "start_time": None,
            "end_time": None,
            "total_hours": 10,
            "row_state": "OFF_MARK",
            "mark_type": "SINGLE_LINE",
            "row_confidence": 0.92,
            "evidence": ["off_mark_detected"],
        }
    ])

    assert len(entries) == 1
    assert entries[0]["total_hours"] is None
    assert entries[0]["row_state"] == "OFF_MARK"
    assert 7 in quality["off_mark_days"]


def test_low_confidence_total_only_is_review_required():
    entries, quality = _apply_semantic_gating([
        {
            "day": 11,
            "start_time": None,
            "end_time": None,
            "total_hours": 8.5,
            "row_state": "WORKED",
            "row_confidence": 0.6,
            "evidence": ["total_only"],
        }
    ])

    assert len(entries) == 1
    assert 11 in quality["review_required_days"]
    reasons = quality["row_quality_by_day"]["11"]["reasons"]
    assert "low_conf_total_only" in reasons


def test_time_total_conflict_is_review_required():
    entries, quality = _apply_semantic_gating([
        {
            "day": 20,
            "start_time": "08:00",
            "end_time": "17:00",
            "total_hours": 4,
            "row_state": "WORKED",
            "row_confidence": 0.95,
        }
    ])

    assert len(entries) == 1
    assert 20 in quality["review_required_days"]
    reasons = quality["row_quality_by_day"]["20"]["reasons"]
    assert "time_total_conflict" in reasons
