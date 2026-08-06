"""Seed a demo work card that exercises every row-quality flag.

Purpose: give the review tab a card whose day rows hit all seven
`review_required` reasons produced by `worker/extractor.py:_apply_semantic_gating`,
plus the cases where a flagged day collides with another row state
(approved / day-status / Saturday) and the flag's colour gets masked.

This writes the same shapes the worker writes (`worker/run.py:523-538`) —
`review_required_days`, `off_mark_days` and `row_quality_by_day` inside
`normalized_result_jsonb` — so the UI cannot tell it apart from a real
extraction. No OpenAI call, no worker run.

Usage (from the repo root — the env must be loaded, see CLAUDE.md):

    set -a && . ./.env && set +a && python3 backend/seed_review_flags.py

Re-running deletes and rebuilds the demo card, so it is safe to repeat.
Pass --month YYYY-MM to target a different processing month.
"""

import argparse
import base64
import os
import sys
from datetime import date, time

from dotenv import load_dotenv

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

from app import create_app  # noqa: E402
from app.extensions import db  # noqa: E402
from app.utils import utc_now  # noqa: E402
from app.models.work_cards import (  # noqa: E402
    WorkCard,
    WorkCardDayEntry,
    WorkCardExtraction,
    WorkCardFile,
)
from app.repositories.business_repository import BusinessRepository  # noqa: E402
from app.repositories.employee_repository import EmployeeRepository  # noqa: E402
from app.repositories.site_repository import SiteRepository  # noqa: E402

load_dotenv()

BUSINESS_CODE = 'automatehq'
SITE_NAME = 'Tel Aviv HQ'
# From DEMO_EMPLOYEES in seed.py — run `python3 backend/seed.py` first.
EMPLOYEE_PASSPORT = 'IL-100001'
DEMO_FILENAME = 'SEED-review-flags.png'
SIBLING_FILENAME = 'SEED-review-flags-approved.png'
ALL_SEED_FILENAMES = (DEMO_FILENAME, SIBLING_FILENAME)
# Days 1..APPROVED_THROUGH_DAY render green ("protected") regardless of any
# quality flag — that masking is intentional here, it is what we want to see.
#
# Protection is NOT read off the card under review: `_approved_boundary_for_month`
# (backend/app/api/work_cards.py:159-176) only counts `approved_through_day` on
# siblings whose review_status is APPROVED. So the fixture also seeds an approved
# sibling card covering these days — setting the field on the demo card alone
# leaves `is_protected` false for every row.
APPROVED_THROUGH_DAY = 3

# 1x1 transparent PNG. The review tab fetches an image for the card; a valid
# (if blank) one keeps the viewer pane from erroring.
BLANK_PNG = base64.b64decode(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk'
    'YPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='
)


def _row(
    day,
    *,
    row_state,
    reasons,
    start=None,
    end=None,
    total=None,
    confidence=None,
    mark_type='NONE',
    day_status=None,
    note=None,
):
    """One demo day: the DB entry plus its row_quality_by_day record."""
    return {
        'day': day,
        'start': start,
        'end': end,
        'total': total,
        'day_status': day_status,
        'note': note,
        'quality': {
            'row_state': row_state,
            'mark_type': mark_type,
            'row_confidence': confidence,
            'has_valid_time_pair': bool(start and end),
            'review_required': bool(reasons),
            'reasons': list(reasons),
            'evidence': [],
        },
    }


# Each of the seven reasons gets its own day, then the collision cases.
DEMO_DAYS = [
    # --- days 1-3 sit inside the approved zone: green wins, flags are hidden ---
    _row(1, row_state='WORKED', reasons=[], start='07:00', end='16:00', total=9.0,
         confidence=0.97, note='approved + clean'),
    _row(2, row_state='WORKED', reasons=['low_row_confidence'], start='07:00', end='16:00',
         total=9.0, confidence=0.55,
         note='FLAGGED but approved -> green masks the amber'),
    _row(3, row_state='OFF_MARK', reasons=[], mark_type='LINE',
         note='off-mark but approved -> green masks the blue'),

    # --- control: a clean, unflagged working day ---
    _row(4, row_state='WORKED', reasons=[], start='08:00', end='17:00', total=9.0,
         confidence=0.96, note='clean control row'),

    # --- one day per review_required reason ---
    _row(5, row_state='WORKED', reasons=['low_row_confidence'], start='07:30', end='16:30',
         total=9.0, confidence=0.62, note='confidence below the 0.80 gate'),
    _row(6, row_state='WORKED', reasons=['time_total_conflict'], start='07:00', end='16:00',
         total=12.0, confidence=0.93, note='times say 9h, written total says 12h'),
    _row(7, row_state='WORKED', reasons=['worked_without_values'], confidence=0.88,
         note='reads as worked but carries no times and no total'),
    _row(8, row_state='WORKED', reasons=['invalid_time_pair'], start='18:00', end='09:00',
         confidence=0.90, note='end before start'),
    _row(9, row_state='WORKED', reasons=['low_conf_total_only'], total=8.0, confidence=0.71,
         note='total-only row below the 0.85 gate'),
    _row(10, row_state='OFF_MARK', reasons=['off_mark_with_time_values'], start='08:00',
         end='17:00', total=9.0, confidence=0.84, mark_type='STRIKE',
         note='struck out yet still has hours — contradictory'),
    _row(11, row_state='ILLEGIBLE', reasons=['total_only_non_worked_state'], total=7.5,
         confidence=0.66, note='a total on a row that did not read as worked'),
    _row(12, row_state='WORKED', reasons=['invalid_time_format'], start='07:00', end='17:00',
         total=10.0, confidence=0.58, note='unparseable time text in the source'),

    # --- off-mark with nothing wrong: blue row, previously the "קו" badge ---
    _row(13, row_state='OFF_MARK', reasons=[], mark_type='LINE', confidence=0.91,
         note='clean off-mark day'),

    # --- more collisions: another colour outranks the amber ---
    _row(15, row_state='WORKED', reasons=['low_row_confidence'], total=6.0, confidence=0.49,
         day_status='SICK', note='FLAGGED + day_status -> purple masks the amber'),

    # --- ordinary days so the table does not look sparse ---
    _row(16, row_state='WORKED', reasons=[], start='08:00', end='17:00', total=9.0,
         confidence=0.95),
    _row(17, row_state='WORKED', reasons=[], start='08:00', end='16:00', total=8.0,
         confidence=0.94),
    _row(20, row_state='WORKED', reasons=['low_row_confidence'], start='09:00', end='15:00',
         total=6.0, confidence=0.44, note='flagged on a plain row -> amber is visible'),
    _row(21, row_state='WORKED', reasons=[], start='08:00', end='17:00', total=9.0,
         confidence=0.92),
]


def _parse_time(value):
    if not value:
        return None
    hour, minute = value.split(':')
    return time(int(hour), int(minute))


def _resolve_month(raw):
    if not raw:
        today = date.today()
        return date(today.year, today.month, 1)
    year, month = raw.split('-')
    return date(int(year), int(month), 1)


def _build_normalized_result(employee):
    """Mirror worker/run.py's normalized_result_jsonb payload."""
    entries = []
    review_required_days = []
    off_mark_days = []
    row_quality_by_day = {}

    for row in DEMO_DAYS:
        quality = row['quality']
        row_quality_by_day[str(row['day'])] = quality
        if quality['review_required']:
            review_required_days.append(row['day'])
        if quality['row_state'] == 'OFF_MARK':
            off_mark_days.append(row['day'])
        entries.append({
            'day': row['day'],
            'start_time': row['start'],
            'end_time': row['end'],
            'total_hours': row['total'],
            'row_state': quality['row_state'],
            'mark_type': quality['mark_type'],
            'row_confidence': quality['row_confidence'],
            'confidence': quality['row_confidence'],
            'evidence': quality['evidence'],
        })

    return {
        'entries': entries,
        'identity_mismatch': False,
        'identity_reason': None,
        'match_is_exact': True,
        'match_is_fuzzy': False,
        'matched_normalized_passport_id': employee.passport_id,
        'review_required_days': sorted(review_required_days),
        'off_mark_days': sorted(off_mark_days),
        'row_quality_by_day': row_quality_by_day,
        'match_candidates': [],
        'matching_decision_reason': 'seeded_demo_card',
        'match_distance': 0,
        'match_candidate_count': 1,
        'template_profile': None,
    }


def _delete_existing(business_id, employee_id, month):
    """Drop a previous run's demo card so this script is re-runnable."""
    stale = (
        WorkCard.query
        .filter_by(
            business_id=business_id,
            employee_id=employee_id,
            processing_month=month,
        )
        .filter(WorkCard.original_filename.in_(ALL_SEED_FILENAMES))
        .all()
    )
    for card in stale:
        db.session.delete(card)  # cascades to file / extraction / day entries
    if stale:
        db.session.flush()
        print(f"  Removed {len(stale)} previous demo card(s).")


# Days the approved sibling owns. These become `is_protected` on the demo card,
# and their displayed values are substituted from here (see _get_sibling_day_context).
SIBLING_DAYS = [
    {'day': 1, 'start': '07:00', 'end': '16:00', 'total': 9.0,
     'note': 'approved earlier card — clean'},
    {'day': 2, 'start': '07:00', 'end': '16:00', 'total': 9.0,
     'note': 'demo card FLAGS this day, but approved green outranks the amber'},
    {'day': 3, 'start': None, 'end': None, 'total': None,
     'note': 'demo card marks this off-mark; approved green outranks the blue'},
]


def _create_approved_sibling(business, employee, site_id, month):
    """An earlier, already-approved card for the same employee-month.

    Its `approved_through_day` is what actually makes days 1-3 protected on the
    demo card — the boundary is computed across approved siblings, not from the
    card being reviewed.
    """
    sibling = WorkCard(
        business_id=business.id,
        site_id=site_id,
        employee_id=employee.id,
        processing_month=month,
        source='ADMIN_SINGLE',
        original_filename=SIBLING_FILENAME,
        mime_type='image/png',
        file_size_bytes=len(BLANK_PNG),
        review_status='APPROVED',
        approved_at=utc_now(),
        approved_through_day=APPROVED_THROUGH_DAY,
        notes='Seeded approved sibling — supplies the protected-day boundary.',
    )
    db.session.add(sibling)
    db.session.flush()

    db.session.add(WorkCardFile(
        work_card_id=sibling.id,
        content_type='image/png',
        file_name=SIBLING_FILENAME,
        file_size_bytes=len(BLANK_PNG),
        image_bytes=BLANK_PNG,
    ))

    for row in SIBLING_DAYS:
        db.session.add(WorkCardDayEntry(
            work_card_id=sibling.id,
            day_of_month=row['day'],
            from_time=_parse_time(row['start']),
            to_time=_parse_time(row['end']),
            total_hours=row['total'],
            comment=row['note'],
            source='ADMIN_MANUAL',
            is_valid=True,
        ))

    return sibling


def seed_review_flag_card(month):
    business = BusinessRepository().get_by_code(BUSINESS_CODE)
    if not business:
        print(f"No business with code '{BUSINESS_CODE}'. Run: python3 backend/seed.py")
        return None

    employee = EmployeeRepository().get_by_passport(EMPLOYEE_PASSPORT, business.id)
    if not employee:
        print(f"No employee with passport '{EMPLOYEE_PASSPORT}'. Run: python3 backend/seed.py")
        return None

    site = SiteRepository().get_by_name_and_business(SITE_NAME, business.id)
    site_id = site.id if site else employee.site_id

    _delete_existing(business.id, employee.id, month)

    # Created first so the demo card is the newer of the two.
    _create_approved_sibling(business, employee, site_id, month)

    card = WorkCard(
        business_id=business.id,
        site_id=site_id,
        employee_id=employee.id,
        processing_month=month,
        source='ADMIN_SINGLE',
        original_filename=DEMO_FILENAME,
        mime_type='image/png',
        file_size_bytes=len(BLANK_PNG),
        review_status='NEEDS_REVIEW',
        approved_through_day=APPROVED_THROUGH_DAY,
        notes='Seeded demo card for row-quality flag QA.',
    )
    db.session.add(card)
    db.session.flush()

    db.session.add(WorkCardFile(
        work_card_id=card.id,
        content_type='image/png',
        file_name=DEMO_FILENAME,
        file_size_bytes=len(BLANK_PNG),
        image_bytes=BLANK_PNG,
    ))

    db.session.add(WorkCardExtraction(
        work_card_id=card.id,
        status='DONE',
        extraction_mode='FULL',
        attempts=1,
        extracted_employee_name=employee.full_name,
        extracted_passport_id=employee.passport_id,
        raw_result_jsonb={'strategy': 'seeded_demo', 'seeded': True},
        normalized_result_jsonb=_build_normalized_result(employee),
        matched_employee_id=employee.id,
        match_method='EXACT_PASSPORT',
        match_confidence=1.0,
        model_name='seed-script',
        pipeline_version='seed',
    ))

    for row in DEMO_DAYS:
        db.session.add(WorkCardDayEntry(
            work_card_id=card.id,
            day_of_month=row['day'],
            from_time=_parse_time(row['start']),
            to_time=_parse_time(row['end']),
            total_hours=row['total'],
            day_status=row['day_status'],
            comment=row['note'],
            source='EXTRACTED',
            is_valid=True,
        ))

    db.session.commit()
    return card, business, employee, site_id


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--month', help='Processing month as YYYY-MM (default: current month)')
    args = parser.parse_args()

    month = _resolve_month(args.month)

    app = create_app()
    with app.app_context():
        result = seed_review_flag_card(month)
        if not result:
            sys.exit(1)
        card, business, employee, site_id = result

        flagged = sorted(r['day'] for r in DEMO_DAYS if r['quality']['review_required'])
        off_mark = sorted(r['day'] for r in DEMO_DAYS if r['quality']['row_state'] == 'OFF_MARK')

        print("\nSeeded demo work card.")
        print(f"  card id           : {card.id}")
        print(f"  employee          : {employee.full_name} ({employee.passport_id})")
        print(f"  processing month  : {month:%Y-%m}")
        print(f"  review_required   : {flagged}")
        print(f"  off_mark          : {off_mark}")
        print(f"  approved sibling  : approved_through_day={APPROVED_THROUGH_DAY} "
              f"-> days 1-{APPROVED_THROUGH_DAY} are protected (green)")
        print(f"\nOpen the review tab at:")
        print(f"  /{business.code}/sites/{site_id}/review")
        print(f"Then pick month {month:%Y-%m} and the '{employee.full_name}' group.")


if __name__ == '__main__':
    main()
