"""Move a work card from one processing month to another.

Why this is more than changing `processing_month`: when the worker extracts a
card it does NOT store every day it read. A day is skipped when it duplicates
the employee's previous card in that month, or when it falls inside the month's
approved range (see worker/run.py). So a card that landed in the wrong month
carries day entries filtered against the wrong siblings, and cards that arrived
after it in that month may have dropped days as "duplicates" of it.

The move therefore rebuilds extracted day entries from the stored extraction
JSON (no new AI call):
  * the moved card, against the target month's cards;
  * the unapproved cards left in the source month that arrived after it.

Days a human saved (source != EXTRACTED) are never touched.

The skip rules below mirror the worker's merge loop. They are duplicated on
purpose so the move does not require any change to the worker; keep the two in
step if the worker's rules change.
"""
from datetime import date, time as dt_time
from typing import Any, Dict, Iterable, List, Optional, Tuple

from sqlalchemy.orm import joinedload

from ..extensions import db
from ..models.audit import AuditEvent
from ..models.work_cards import WorkCard, WorkCardDayEntry, WorkCardExtraction

MACHINE_SOURCE = 'EXTRACTED'

# Statuses whose cards are never rebuilt as source-month siblings.
_FROZEN_SIBLING_STATUSES = ('APPROVED', 'REJECTED', 'SPLITTING')


class MoveMonthError(Exception):
    """A move that cannot be performed. `code` is stable for the frontend."""

    def __init__(self, code: str, message: str, status_code: int = 409):
        super().__init__(message)
        self.code = code
        self.message = message
        self.status_code = status_code


# ---------------------------------------------------------------------------
# Pure helpers (no I/O)
# ---------------------------------------------------------------------------

def parse_month(value: Any) -> Optional[date]:
    """Parse 'YYYY-MM' or 'YYYY-MM-DD' into the first day of that month."""
    if not isinstance(value, str):
        return None
    parts = value.strip().split('-')
    if len(parts) not in (2, 3):
        return None
    try:
        return date(int(parts[0]), int(parts[1]), 1)
    except ValueError:
        return None


def _parse_time(value: Any) -> Optional[dt_time]:
    if not value:
        return None
    try:
        parts = str(value).split(':')
        if len(parts) >= 2:
            return dt_time(hour=int(parts[0]), minute=int(parts[1]))
    except (ValueError, TypeError):
        pass
    return None


def _comparable(from_time: Any, to_time: Any, total_hours: Any) -> Tuple:
    def norm_time(v):
        if v is None:
            return None
        return f"{int(v.hour):02d}:{int(v.minute):02d}"

    def norm_hours(v):
        if v is None or v == '':
            return None
        try:
            return round(float(v), 2)
        except (TypeError, ValueError):
            return None

    return (norm_time(from_time), norm_time(to_time), norm_hours(total_hours))


def _same_as_previous(extracted: Dict[str, Any], previous_entry: Any) -> bool:
    return _comparable(
        _parse_time(extracted.get('start_time')),
        _parse_time(extracted.get('end_time')),
        extracted.get('total_hours'),
    ) == _comparable(
        previous_entry.from_time, previous_entry.to_time, previous_entry.total_hours
    )


def plan_day_entries(
    extracted_entries: Iterable[Dict[str, Any]],
    existing_days: Iterable[int],
    previous_entries_by_day: Dict[int, Any],
    protected_through_day: int,
) -> Dict[str, Any]:
    """Decide which extracted days to write for a card. Mirrors the worker.

    A day is skipped when the card already holds it, when it sits inside the
    month's approved range, or when it repeats the previous card's values.

    Returns {'create': [extracted entry, ...], 'skipped_protected': n,
             'skipped_duplicate': n}.
    """
    taken = set(existing_days)
    create: List[Dict[str, Any]] = []
    skipped_protected = 0
    skipped_duplicate = 0
    for entry in extracted_entries or []:
        day = entry.get('day') if isinstance(entry, dict) else None
        if not isinstance(day, int) or day < 1 or day > 31:
            continue
        if day in taken:
            continue
        if protected_through_day and day <= protected_through_day:
            skipped_protected += 1
            continue
        previous = previous_entries_by_day.get(day)
        if previous is not None and _same_as_previous(entry, previous):
            skipped_duplicate += 1
            continue
        taken.add(day)
        create.append(entry)
    return {
        'create': create,
        'skipped_protected': skipped_protected,
        'skipped_duplicate': skipped_duplicate,
    }


# ---------------------------------------------------------------------------
# DB helpers
# ---------------------------------------------------------------------------

def _employee_month_cards(card: WorkCard, month: date) -> List[WorkCard]:
    """Other cards of this card's employee in `month` (same site scoping the
    worker uses: filter by site only when the card has one)."""
    if not card.employee_id:
        return []
    # populate_existing: day entries are rewritten during a move, so cards
    # already in the session must reload theirs rather than serve a stale list.
    query = db.session.query(WorkCard).populate_existing().options(
        joinedload(WorkCard.day_entries)
    ).filter(
        WorkCard.employee_id == card.employee_id,
        WorkCard.processing_month == month,
        WorkCard.business_id == card.business_id,
        WorkCard.id != card.id,
    )
    if card.site_id:
        query = query.filter(WorkCard.site_id == card.site_id)
    return query.all()


def _stored_entries(card_id) -> Optional[List[Dict[str, Any]]]:
    """Extracted day rows saved by a finished extraction, or None when there is
    nothing to rebuild from (no extraction, still queued, or failed)."""
    extraction = db.session.query(WorkCardExtraction).filter_by(work_card_id=card_id).first()
    if not extraction or extraction.status != 'DONE':
        return None
    normalized = extraction.normalized_result_jsonb or {}
    entries = normalized.get('entries')
    return entries if isinstance(entries, list) else None


def _rebuild_card(card: WorkCard, siblings: List[WorkCard], replace_extracted: bool) -> Dict[str, int]:
    """Write a card's extracted days against `siblings` (the other cards of the
    employee-month it now lives in).

    replace_extracted=True drops the card's current EXTRACTED rows first (the
    moved card: they were filtered against the wrong month). False only adds
    days the card lacks (source-month siblings).
    """
    result = {'created': 0, 'skipped_protected': 0, 'skipped_duplicate': 0}
    stored = _stored_entries(card.id)
    if stored is None:
        return result

    if replace_extracted:
        db.session.query(WorkCardDayEntry).filter(
            WorkCardDayEntry.work_card_id == card.id,
            WorkCardDayEntry.source == MACHINE_SOURCE,
        ).delete(synchronize_session=False)
        db.session.flush()

    existing_days = [
        row[0] for row in db.session.query(WorkCardDayEntry.day_of_month).filter(
            WorkCardDayEntry.work_card_id == card.id
        ).all()
    ]

    # The worker compares against the newest card that existed when this one was
    # extracted, i.e. the latest sibling created before it.
    earlier = [
        s for s in siblings
        if s.created_at is not None and card.created_at is not None and s.created_at < card.created_at
    ]
    previous = max(earlier, key=lambda s: s.created_at) if earlier else None
    previous_by_day = {e.day_of_month: e for e in previous.day_entries} if previous else {}

    protected = max(
        (s.approved_through_day or 0 for s in siblings if s.review_status == 'APPROVED'),
        default=0,
    )

    plan = plan_day_entries(stored, existing_days, previous_by_day, protected)
    for entry in plan['create']:
        db.session.add(WorkCardDayEntry(
            work_card_id=card.id,
            day_of_month=entry['day'],
            from_time=_parse_time(entry.get('start_time')),
            to_time=_parse_time(entry.get('end_time')),
            total_hours=entry.get('total_hours'),
            source=MACHINE_SOURCE,
            is_valid=True,
        ))
    db.session.flush()
    result['created'] = len(plan['create'])
    result['skipped_protected'] = plan['skipped_protected']
    result['skipped_duplicate'] = plan['skipped_duplicate']
    return result


# ---------------------------------------------------------------------------
# Public entry point
# ---------------------------------------------------------------------------

def move_work_card_month(card: WorkCard, target_month: date, actor_user_id=None) -> Dict[str, Any]:
    """Move `card` to `target_month` and rebuild affected extracted day entries.

    All changes are committed together; on any failure nothing is changed.
    Raises MoveMonthError for a move that is not allowed.
    """
    source_month = card.processing_month
    if target_month == source_month:
        raise MoveMonthError('SAME_MONTH', 'Work card is already in this month', 400)

    if card.review_status == 'APPROVED':
        raise MoveMonthError(
            'CARD_APPROVED',
            'An approved work card cannot be moved to another month',
        )
    if card.review_status == 'SPLITTING':
        raise MoveMonthError('CARD_PROCESSING', 'Work card is still being processed')

    extraction = db.session.query(WorkCardExtraction).filter_by(work_card_id=card.id).first()
    if extraction and extraction.status == 'RUNNING':
        raise MoveMonthError('CARD_PROCESSING', 'Work card is still being processed')

    if card.sha256_hash:
        duplicate = db.session.query(WorkCard.id).filter(
            WorkCard.business_id == card.business_id,
            WorkCard.processing_month == target_month,
            WorkCard.sha256_hash == card.sha256_hash,
            WorkCard.id != card.id,
        ).first()
        if duplicate:
            raise MoveMonthError(
                'DUPLICATE_IN_TARGET',
                'The same image already exists in the target month',
            )

    try:
        # Cards left behind that were extracted while the moved card was their
        # "previous card" candidate — collected before the month changes.
        source_siblings = _employee_month_cards(card, source_month)
        later_source_siblings = [
            s for s in source_siblings
            if s.review_status not in _FROZEN_SIBLING_STATUSES
            and s.created_at is not None and card.created_at is not None
            and s.created_at > card.created_at
        ]
        source_has_approved = any(s.review_status == 'APPROVED' for s in source_siblings)

        card.processing_month = target_month
        # Month-scoped flags do not travel with the card.
        card.completes_month = False
        card.approved_through_day = None
        db.session.flush()

        moved = _rebuild_card(
            card, _employee_month_cards(card, target_month), replace_extracted=True
        )

        siblings_restored_days = 0
        for sibling in sorted(later_source_siblings, key=lambda s: s.created_at):
            rebuilt = _rebuild_card(
                sibling, _employee_month_cards(sibling, source_month), replace_extracted=False
            )
            siblings_restored_days += rebuilt['created']

        summary = {
            'from_month': source_month.isoformat(),
            'to_month': target_month.isoformat(),
            'days_written': moved['created'],
            'days_skipped_protected': moved['skipped_protected'],
            'days_skipped_duplicate': moved['skipped_duplicate'],
            'source_siblings_rebuilt': len(later_source_siblings),
            'source_days_restored': siblings_restored_days,
            'source_month_has_approved_card': source_has_approved,
        }

        db.session.add(AuditEvent(
            business_id=card.business_id,
            actor_user_id=actor_user_id,
            event_type='MOVE_MONTH',
            entity_type='WORK_CARD',
            entity_id=card.id,
            site_id=card.site_id,
            employee_id=card.employee_id,
            work_card_id=card.id,
            event_metadata=summary,
        ))
        db.session.commit()
        return summary
    except Exception:
        db.session.rollback()
        raise
