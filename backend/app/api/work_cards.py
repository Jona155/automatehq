from flask import Blueprint, request, g, send_file
from datetime import datetime, time
from werkzeug.utils import secure_filename
from io import BytesIO
import zipfile
import unicodedata
import logging
from uuid import UUID
import re
from typing import Any, Dict, Optional, Set, Tuple
from ..repositories.work_card_repository import WorkCardRepository
from ..repositories.work_card_file_repository import WorkCardFileRepository
from ..repositories.work_card_extraction_repository import WorkCardExtractionRepository
from ..repositories.work_card_day_entry_repository import WorkCardDayEntryRepository
from ..repositories.employee_repository import EmployeeRepository
from .utils import api_response, model_to_dict, models_to_list
from ..auth_utils import token_required, role_required
from ..extensions import db
from ..models.sites import Site
from ..models.work_cards import WorkCard
from ..services.whatsapp_listener_client import (
    WhatsAppListenerClient,
    WhatsAppListenerError,
    WhatsAppAuthError,
    WhatsAppBadRequestError,
    WhatsAppNotConnectedError,
    WhatsAppPayloadTooLargeError,
)

logger = logging.getLogger(__name__)

work_cards_bp = Blueprint('work_cards', __name__, url_prefix='/api/work_cards')
repo = WorkCardRepository()
file_repo = WorkCardFileRepository()
extraction_repo = WorkCardExtractionRepository()
day_entry_repo = WorkCardDayEntryRepository()
employee_repo = EmployeeRepository()


def _normalize_time_value(value: Any) -> Optional[str]:
    if value is None:
        return None
    if hasattr(value, 'hour') and hasattr(value, 'minute'):
        return f"{int(value.hour):02d}:{int(value.minute):02d}"
    raw = str(value).strip()
    if not raw:
        return None
    parts = raw.split(':')
    if len(parts) < 2:
        return raw
    try:
        return f"{int(parts[0]):02d}:{int(parts[1]):02d}"
    except ValueError:
        return raw


def _normalize_hours_value(value: Any) -> Optional[float]:
    if value is None or value == '':
        return None
    try:
        return round(float(value), 2)
    except (TypeError, ValueError):
        return None


def _entry_signature(from_time: Any, to_time: Any, total_hours: Any, day_status: Any = None) -> Tuple:
    return (
        _normalize_time_value(from_time),
        _normalize_time_value(to_time),
        _normalize_hours_value(total_hours),
        day_status,
    )


def _entries_equal(a: Any, b: Any) -> bool:
    return _entry_signature(a.from_time, a.to_time, a.total_hours, a.day_status) == _entry_signature(
        b.from_time, b.to_time, b.total_hours, b.day_status
    )


def _resolve_conflict_day(current_entry, previous_entry, previous_status, day_in_override_days):
    """Decide a single day's outcome when reconciling the latest card against a
    previous sibling card during approval. Pure — performs no I/O.

    Returns one of:
      'noop'          — values identical; leave both entries untouched
      'take_latest'   — latest value wins; delete the previous-card entry
      'take_previous' — keep the approved previous value; replace the latest entry
      'carry_forward' — latest card has no entry for this day; clone the previous value

    The latest value wins when the previous card is not yet approved, when the
    admin flagged this day as an override on the request, OR when the latest
    entry is a persisted manual override (source=MANUAL_OVERRIDE). The last case
    is what makes a deliberate edit survive approval even if the request carries
    no override flag (e.g. approved after a reload that dropped the in-memory
    unlock state).
    """
    if current_entry is None:
        return 'carry_forward'
    if _entries_equal(current_entry, previous_entry):
        return 'noop'
    if previous_status != 'APPROVED':
        return 'take_latest'
    if day_in_override_days or current_entry.source == 'MANUAL_OVERRIDE':
        return 'take_latest'
    return 'take_previous'


def _sibling_entry_outranks(candidate: Dict[str, Any], existing: Dict[str, Any]) -> bool:
    """Whether `candidate` should win a day over `existing` when consolidating
    sibling cards: an APPROVED card's value (the locked source of truth) beats a
    non-approved one; within the same approval tier the latest card wins."""
    if candidate['is_approved'] != existing['is_approved']:
        return candidate['is_approved']
    ca, ea = candidate.get('created_at'), existing.get('created_at')
    if ca is None or ea is None:
        return False
    return ca > ea


def _get_sibling_day_context(card: Any) -> Dict[int, Dict[str, Any]]:
    """Consolidate EVERY other work card for this employee/month/site into a
    per-day "previous" view. For each day the authoritative entry comes from an
    APPROVED sibling when one exists (locked source of truth), otherwise from the
    latest sibling to record that day. This single source backs both the merged
    review table and the approval carry-forward, so what the admin sees is what
    gets approved — and all sibling cards (not just the immediate previous one)
    fold into the approved month snapshot.

    Returns {day_of_month: {entry, is_approved, card_id, card_status, created_at}}.
    """
    if not card.employee_id:
        return {}
    sibling_cards = [
        c for c in repo.get_for_monthly_breakdown(
            employee_id=card.employee_id,
            month=card.processing_month,
            business_id=card.business_id,
            site_id=card.site_id,
        )
        if c.id != card.id
    ]
    by_day: Dict[int, Dict[str, Any]] = {}
    for sibling in sibling_cards:
        is_approved = sibling.review_status == 'APPROVED'
        for entry in sibling.day_entries:
            candidate = {
                'entry': entry,
                'is_approved': is_approved,
                'card_id': sibling.id,
                'card_status': sibling.review_status,
                'created_at': sibling.created_at,
            }
            existing = by_day.get(entry.day_of_month)
            if existing is None or _sibling_entry_outranks(candidate, existing):
                by_day[entry.day_of_month] = candidate
    return by_day

@work_cards_bp.route('/manual', methods=['POST'])
@token_required
@role_required('ADMIN')
def create_manual_work_card():
    """Create a ghost work card (no image, no extraction) for manual hours entry.

    Used when an employee has no physical work card but the admin still wants to
    record their hours. Reuses every downstream pipeline (day entries, conflict
    detection, approval) by relying on a regular `work_cards` row whose `files`
    and `extraction` relationships stay null.
    """
    import uuid as uuid_module

    data = request.get_json() or {}
    site_id_str = data.get('site_id')
    employee_id_str = data.get('employee_id')
    month_str = data.get('processing_month')

    if not site_id_str or not employee_id_str or not month_str:
        return api_response(
            status_code=400,
            message="site_id, employee_id, and processing_month are required",
            error="Bad Request"
        )

    try:
        site_id = uuid_module.UUID(site_id_str)
        employee_id = uuid_module.UUID(employee_id_str)
    except ValueError:
        return api_response(status_code=400, message="Invalid UUID format", error="Bad Request")

    try:
        month = datetime.strptime(month_str, '%Y-%m-%d').date()
    except ValueError:
        return api_response(status_code=400, message="Invalid month format. Use YYYY-MM-DD", error="Bad Request")

    # Verify the employee belongs to this business and site.
    employee = employee_repo.get_by_id(employee_id)
    if not employee or employee.business_id != g.business_id:
        return api_response(status_code=404, message="Employee not found", error="Not Found")
    if employee.site_id and employee.site_id != site_id:
        return api_response(
            status_code=400,
            message="Employee does not belong to this site",
            error="Bad Request"
        )

    # Verify the site belongs to this business.
    site = db.session.query(Site).filter_by(id=site_id, business_id=g.business_id).first()
    if not site:
        return api_response(status_code=404, message="Site not found", error="Not Found")

    # Prevent duplicate manual ghost cards for the same (employee, site, month).
    # Image cards uploaded later are still allowed — they go through the conflict flow.
    existing_manual = (
        db.session.query(WorkCard)
        .filter(
            WorkCard.business_id == g.business_id,
            WorkCard.site_id == site_id,
            WorkCard.employee_id == employee_id,
            WorkCard.processing_month == month,
            WorkCard.source == 'MANUAL',
        )
        .first()
    )
    if existing_manual:
        return api_response(
            data=model_to_dict(existing_manual),
            message="Manual work card already exists for this employee/site/month",
            status_code=200,
        )

    try:
        work_card = repo.create(
            business_id=g.business_id,
            site_id=site_id,
            employee_id=employee_id,
            processing_month=month,
            source='MANUAL',
            uploaded_by_user_id=g.current_user.id,
            review_status='NEEDS_REVIEW',
        )
        return api_response(
            data=model_to_dict(work_card),
            message="Manual work card created successfully",
            status_code=201,
        )
    except Exception as e:
        logger.exception("Failed to create manual work card")
        return api_response(status_code=500, message="Failed to create manual work card", error=str(e))


@work_cards_bp.route('/missing', methods=['GET'])
@token_required
def get_missing_work_card_employees():
    """Return active employees who have no work card for the given month."""
    from datetime import date as date_type
    import uuid as uuid_module

    month_str = request.args.get('month')
    site_id_str = request.args.get('site_id')

    if not month_str:
        return api_response(status_code=400, message="month parameter is required", error="Bad Request")
    try:
        month = date_type.fromisoformat(month_str)
    except ValueError:
        return api_response(status_code=400, message="Invalid month format, use YYYY-MM-DD", error="Bad Request")

    site_id = None
    if site_id_str:
        try:
            site_id = uuid_module.UUID(site_id_str)
        except ValueError:
            return api_response(status_code=400, message="Invalid site_id format", error="Bad Request")

    try:
        employees = employee_repo.get_missing_work_card_employees(
            business_id=g.business_id, month=month, site_id=site_id
        )
        return api_response(data=models_to_list(employees))
    except Exception as e:
        logger.exception("Failed to get missing work card employees")
        return api_response(status_code=500, message="Failed to fetch missing employees", error=str(e))


@work_cards_bp.route('', methods=['GET'])
@token_required
def get_work_cards():
    """Get work cards in the current business, filtered by site+month or status."""
    site_id = request.args.get('site_id')
    month_str = request.args.get('month') # YYYY-MM-DD
    status = request.args.get('status')
    include_employee = request.args.get('include_employee', 'false').lower() == 'true'
    
    if site_id and month_str:
        try:
            month = datetime.strptime(month_str, '%Y-%m-%d').date()
            if include_employee:
                results = repo.get_by_site_month_with_employee(site_id, month, business_id=g.business_id)
            else:
                results = repo.get_by_site_month(site_id, month, business_id=g.business_id)
        except ValueError:
            return api_response(status_code=400, message="Invalid month format. Use YYYY-MM-DD", error="Bad Request")
    elif status:
        results = repo.get_by_review_status(status, business_id=g.business_id)
    else:
        results = repo.get_all_for_business(business_id=g.business_id)
    
    # Serialize results with optional employee data
    data = []
    for card in results:
        card_dict = model_to_dict(card)
        if include_employee and hasattr(card, 'employee') and card.employee:
            card_dict['employee'] = model_to_dict(card.employee)
        data.append(card_dict)
        
    return api_response(data=data)

@work_cards_bp.route('/<uuid:card_id>', methods=['GET'])
@token_required
def get_work_card(card_id):
    """Get a specific work card (must belong to current business), optionally with details."""
    include_details = request.args.get('details', 'false').lower() == 'true'
    
    if include_details:
        card = repo.get_with_all_relations(card_id)
    else:
        card = repo.get_by_id(card_id)
    
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")
    
    data = model_to_dict(card)
    
    # Handle relationships if loaded
    if include_details:
        if card.extraction:
            data['extraction'] = model_to_dict(card.extraction)
        if card.day_entries:
            data['day_entries'] = models_to_list(card.day_entries)
        if card.files:
            data['files'] = models_to_list(card.files)
            
    return api_response(data=data)

def compute_monthly_breakdown_payload(current_card: WorkCard, sibling_cards) -> Dict[str, Any]:
    """Pure-function variant: given the current card and the pre-loaded sibling
    cards (with day_entries loaded), compute the per-card contribution payload.

    Days that exist in an earlier-ordered card are attributed to that card; later
    cards only get credit for the new days they add.
    """

    # Order: APPROVED first, then by approved_at asc, then created_at asc, then id.
    def _order_key(card: WorkCard):
        return (
            0 if card.review_status == 'APPROVED' else 1,
            card.approved_at or card.created_at,
            card.created_at,
            str(card.id),
        )

    ordered = sorted(sibling_cards, key=_order_key)

    claimed_days: Set[int] = set()
    cards_payload = []
    approved_total = 0.0
    current_card_contribution = 0.0

    for card in ordered:
        contribution = 0.0
        new_days = []
        for entry in card.day_entries:
            if entry.day_of_month in claimed_days:
                continue
            if entry.total_hours is None:
                continue
            contribution += float(entry.total_hours)
            new_days.append(entry.day_of_month)
        claimed_days.update(new_days)

        is_current = card.id == current_card.id
        if card.review_status == 'APPROVED':
            approved_total += contribution
        if is_current:
            current_card_contribution = contribution

        cards_payload.append({
            'id': str(card.id),
            'review_status': card.review_status,
            'approved_at': card.approved_at.isoformat() if card.approved_at else None,
            'created_at': card.created_at.isoformat() if card.created_at else None,
            'source': card.source,
            'contribution_hours': round(contribution, 2),
            'is_current': is_current,
        })

    if current_card.review_status == 'APPROVED':
        projected_total = approved_total
    else:
        projected_total = approved_total + current_card_contribution

    return {
        'employee_id': str(current_card.employee_id),
        'processing_month': current_card.processing_month.isoformat(),
        'site_id': str(current_card.site_id) if current_card.site_id else None,
        'cards': cards_payload,
        'approved_total_hours': round(approved_total, 2),
        'current_card_contribution_hours': round(current_card_contribution, 2),
        'projected_total_hours': round(projected_total, 2),
    }


def unapprove_card_on_edit(card: WorkCard, had_any_change: bool) -> bool:
    """Editing an approved card un-approves it so the admin must re-review.
    Returns True if the card was flipped, False otherwise. Mutates the card
    in place; caller is responsible for committing.
    """
    if card.review_status == 'APPROVED' and had_any_change:
        card.review_status = 'NEEDS_REVIEW'
        card.approved_at = None
        card.approved_by_user_id = None
        return True
    return False


def _compute_monthly_breakdown(current_card: WorkCard) -> Dict[str, Any]:
    sibling_cards = repo.get_for_monthly_breakdown(
        employee_id=current_card.employee_id,
        month=current_card.processing_month,
        business_id=current_card.business_id,
        site_id=current_card.site_id,
    )
    return compute_monthly_breakdown_payload(current_card, sibling_cards)


@work_cards_bp.route('/<uuid:card_id>/monthly-breakdown', methods=['GET'])
@token_required
def get_work_card_monthly_breakdown(card_id):
    """Return per-card monthly hours breakdown for the card's employee/site/month."""
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")

    if not card.employee_id:
        return api_response(
            data={
                'employee_id': None,
                'processing_month': card.processing_month.isoformat(),
                'site_id': str(card.site_id) if card.site_id else None,
                'cards': [],
                'approved_total_hours': 0.0,
                'current_card_contribution_hours': 0.0,
                'projected_total_hours': 0.0,
            }
        )

    return api_response(data=_compute_monthly_breakdown(card))


@work_cards_bp.route('/<uuid:card_id>', methods=['PUT'])
@token_required
@role_required('ADMIN')
def update_work_card(card_id):
    """Update a work card (must belong to current business, e.g. assign employee)."""
    # Verify ownership
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")
    
    data = request.get_json()
    if not data:
        return api_response(status_code=400, message="No data provided", error="Bad Request")
    
    # Prevent changing business_id
    if 'business_id' in data:
        del data['business_id']

    # Keep review status aligned with assignment state.
    # Manual assignment should move cards out of NEEDS_ASSIGNMENT to NEEDS_REVIEW.
    if 'employee_id' in data:
        has_employee = bool(data.get('employee_id'))
        if has_employee and card.review_status == 'NEEDS_ASSIGNMENT':
            data['review_status'] = 'NEEDS_REVIEW'
        elif not has_employee:
            data['review_status'] = 'NEEDS_ASSIGNMENT'

        # Derive site_id from the assigned employee when the card has no site yet.
        if has_employee and card.site_id is None:
            assigned_employee = employee_repo.get_by_id(data['employee_id'])
            if assigned_employee and assigned_employee.site_id:
                data['site_id'] = str(assigned_employee.site_id)

    try:
        updated_card = repo.update(card_id, **data)
        if not updated_card:
            return api_response(status_code=404, message="Work card not found", error="Not Found")

        if 'employee_id' in data:
            from .dashboard import invalidate_business_cache
            invalidate_business_cache(g.business_id)
        return api_response(data=model_to_dict(updated_card), message="Work card updated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to update work card", error=str(e))

@work_cards_bp.route('/<uuid:card_id>/status', methods=['PUT'])
@token_required
@role_required('ADMIN')
def update_status(card_id):
    """Update review status (must belong to current business)."""
    # Verify ownership
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")
    
    data = request.get_json()
    status = data.get('status')
    
    if not status:
         return api_response(status_code=400, message="Status is required", error="Bad Request")
         
    try:
        updated_card = repo.update_review_status(card_id, status, g.business_id)
        if not updated_card:
             return api_response(status_code=404, message="Work card not found", error="Not Found")
             
        return api_response(data=model_to_dict(updated_card), message="Status updated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to update status", error=str(e))

@work_cards_bp.route('/<uuid:card_id>/approve', methods=['POST'])
@token_required
@role_required('ADMIN')
def approve_work_card(card_id):
    """Approve a work card (must belong to current business)."""
    # Verify ownership
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")
    
    data = request.get_json() or {}
    user_id = data.get('user_id')
    override_conflict_days = data.get('override_conflict_days') or []
    confirm_override_approved = bool(data.get('confirm_override_approved', False))
    auto_keep_approved = bool(data.get('auto_keep_approved', False))
    # Employee-month review approves the whole group at once: once the primary
    # card's merged table is approved, the leftover sibling cards are superseded
    # so the employee no longer reads as pending anywhere.
    supersede_siblings = bool(data.get('supersede_siblings', False))
    
    if not user_id:
        return api_response(status_code=400, message="User ID is required for approval", error="Bad Request")

    if not isinstance(override_conflict_days, list):
        return api_response(status_code=400, message="override_conflict_days must be an array", error="Bad Request")

    override_days: Set[int] = set()
    for item in override_conflict_days:
        if not isinstance(item, int) or item < 1 or item > 31:
            return api_response(
                status_code=400,
                message="override_conflict_days must contain integers between 1 and 31",
                error="Bad Request"
            )
        override_days.add(item)

    try:
        # Consolidate EVERY sibling card (not just the immediate previous one) so
        # all of them fold into this card's approved month snapshot.
        prev_by_day = _get_sibling_day_context(card)
        current_entries = day_entry_repo.get_by_work_card(card.id)
        current_entries_by_day = {entry.day_of_month: entry for entry in current_entries}

        approved_conflict_days = set()
        for day, prev in prev_by_day.items():
            current_entry = current_entries_by_day.get(day)
            if current_entry and prev['is_approved'] and not _entries_equal(current_entry, prev['entry']):
                approved_conflict_days.add(day)

        requested_approved_overrides = override_days.intersection(approved_conflict_days)
        if approved_conflict_days and not confirm_override_approved and not auto_keep_approved:
            return api_response(
                status_code=409,
                message=(
                    "Overriding approved previous data requires explicit confirmation. "
                    "Resubmit with confirm_override_approved=true."
                ),
                error="Conflict",
                data={
                    'approved_conflict_days': sorted(list(approved_conflict_days))
                }
            )

        # Resolve each sibling day against this card before approving it.
        for day, prev in prev_by_day.items():
            previous_entry = prev['entry']
            current_entry = current_entries_by_day.get(day)
            outcome = _resolve_conflict_day(
                current_entry,
                previous_entry,
                'APPROVED' if prev['is_approved'] else prev['card_status'],
                day in override_days,
            )

            if outcome == 'noop':
                continue
            if outcome == 'take_latest':
                # This card's value wins — drop the sibling's entry for this day.
                day_entry_repo.delete(previous_entry.id)
            elif outcome == 'take_previous':
                # Keep the approved sibling value; replace this card's entry.
                if current_entry is not None:
                    day_entry_repo.delete(current_entry.id)
                current_entries_by_day.pop(day, None)
                cloned = day_entry_repo.create(
                    work_card_id=card.id,
                    day_of_month=day,
                    from_time=previous_entry.from_time,
                    to_time=previous_entry.to_time,
                    total_hours=previous_entry.total_hours,
                    day_status=previous_entry.day_status,
                    attributed_site_id=previous_entry.attributed_site_id,
                    source='CARRIED_FORWARD',
                    is_valid=True
                )
                current_entries_by_day[day] = cloned
            elif outcome == 'carry_forward':
                # Sibling-only day — clone it in so the approved card holds the full month.
                cloned = day_entry_repo.create(
                    work_card_id=card.id,
                    day_of_month=day,
                    from_time=previous_entry.from_time,
                    to_time=previous_entry.to_time,
                    total_hours=previous_entry.total_hours,
                    day_status=previous_entry.day_status,
                    attributed_site_id=previous_entry.attributed_site_id,
                    source='CARRIED_FORWARD',
                    is_valid=True
                )
                current_entries_by_day[day] = cloned

        approved_card = repo.approve_card(card_id, user_id, g.business_id)
        if not approved_card:
            return api_response(status_code=404, message="Work card not found", error="Not Found")

        if supersede_siblings and approved_card.employee_id:
            repo.supersede_sibling_cards(
                primary_card_id=approved_card.id,
                employee_id=approved_card.employee_id,
                month=approved_card.processing_month,
                business_id=g.business_id,
                user_id=user_id,
                site_id=approved_card.site_id,
            )

        return api_response(data=model_to_dict(approved_card), message="Work card approved successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to approve work card", error=str(e))

@work_cards_bp.route('/<uuid:card_id>', methods=['DELETE'])
@token_required
@role_required('ADMIN')
def delete_work_card(card_id):
    """Delete a work card (must belong to current business)."""
    from ..models.audit import AuditEvent
    from ..models.telegram import TelegramIngestedFile
    from ..models.whatsapp import WhatsAppIngestedMessage

    # Verify ownership
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")

    try:
        # NULL out FKs from tables whose rows we want to keep (audit/ingestion logs).
        # These FKs have no ON DELETE rule, so leaving them would block the delete.
        db.session.query(AuditEvent).filter(AuditEvent.work_card_id == card_id).update(
            {AuditEvent.work_card_id: None}, synchronize_session=False
        )
        db.session.query(TelegramIngestedFile).filter(TelegramIngestedFile.work_card_id == card_id).update(
            {TelegramIngestedFile.work_card_id: None}, synchronize_session=False
        )
        db.session.query(WhatsAppIngestedMessage).filter(WhatsAppIngestedMessage.work_card_id == card_id).update(
            {WhatsAppIngestedMessage.work_card_id: None}, synchronize_session=False
        )

        db.session.delete(card)
        db.session.commit()
        from .dashboard import invalidate_business_cache
        invalidate_business_cache(g.business_id)
        return api_response(message="Work card deleted successfully", status_code=200)
    except Exception as e:
        db.session.rollback()
        logger.exception("Failed to delete work card %s", card_id)
        return api_response(status_code=500, message="Failed to delete work card", error=str(e))

@work_cards_bp.route('/<uuid:card_id>/file', methods=['GET'])
@token_required
def get_work_card_file(card_id):
    """Get the image file for a work card."""
    # Verify ownership
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")
    
    # Get the file
    file = file_repo.get_by_work_card(card_id)
    if not file:
        return api_response(status_code=404, message="File not found for this work card", error="Not Found")
    
    try:
        # The stored image bytes for a card never change, so let the browser
        # cache them aggressively. Without these headers every employee
        # (re-)selection re-downloads the full blob from Postgres over the
        # network — fine on localhost, slow in production.
        # ETag (the immutable file row id) enables conditional 304 revalidation.
        response = send_file(
            BytesIO(file.image_bytes),
            mimetype=file.content_type,
            as_attachment=False,
            download_name=file.file_name,
            etag=str(file.id),
            conditional=True,
        )
        # `private` so shared/proxy caches don't store tenant images.
        response.headers['Cache-Control'] = 'private, max-age=86400, immutable'
        return response
    except Exception as e:
        return api_response(status_code=500, message="Failed to retrieve file", error=str(e))


# Map a content_type to a sensible file extension for the WhatsApp filename.
_CONTENT_TYPE_EXT = {
    'image/jpeg': 'jpg',
    'image/jpg': 'jpg',
    'image/png': 'png',
    'image/gif': 'gif',
    'image/webp': 'webp',
    'application/pdf': 'pdf',
}


@work_cards_bp.route('/<uuid:card_id>/send-whatsapp', methods=['POST'])
@token_required
def send_work_card_to_whatsapp(card_id):
    """Send a work card's image + a free-text note to a WhatsApp group.

    Used from the review UI when an admin can't read a card and wants to ask the
    group for help. Forwards the stored image bytes to the listener's
    send-document endpoint — no Twilio / public URL involved.
    """
    # Verify ownership (same tenancy guard as get_work_card_file).
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")

    data = request.get_json() or {}
    chat_id = (data.get('chat_id') or '').strip()
    note = data.get('note')
    if note is not None:
        note = str(note).strip() or None

    if not chat_id or not chat_id.endswith('@g.us'):
        return api_response(status_code=400, message="A valid WhatsApp group chat_id is required", error="Bad Request")

    file = file_repo.get_by_work_card(card_id)
    if not file:
        return api_response(status_code=400, message="This work card has no image to send", error="Bad Request")

    client = WhatsAppListenerClient.from_env()
    if client is None:
        return api_response(status_code=503, message="WhatsApp listener not configured", error="WA_LISTENER_URL is not set")

    content_type = (file.content_type or '').lower()
    ext = _CONTENT_TYPE_EXT.get(content_type, 'jpg')
    filename = f"work_card_{card_id}.{ext}"

    try:
        if content_type.startswith('image/'):
            # Send as an inline photo so it previews in WhatsApp instead of
            # arriving as a downloadable file attachment.
            client.send_image(
                chat_id=chat_id,
                file_bytes=file.image_bytes,
                caption=note,
                mimetype=file.content_type,
            )
        else:
            # Non-images (e.g. PDF) can't render inline — send as a document.
            client.send_document(
                chat_id=chat_id,
                file_bytes=file.image_bytes,
                filename=filename,
                caption=note,
                mimetype=file.content_type,
            )
    except WhatsAppNotConnectedError as e:
        return api_response(status_code=503, message="WhatsApp listener not connected", error=str(e))
    except WhatsAppPayloadTooLargeError as e:
        return api_response(status_code=413, message="Image is too large to send over WhatsApp", error=str(e))
    except WhatsAppAuthError as e:
        logger.error(f"Listener auth failure: {e}")
        return api_response(status_code=500, message="WhatsApp listener auth misconfigured", error="Server Error")
    except (WhatsAppBadRequestError, WhatsAppListenerError) as e:
        logger.warning(f"send_work_card_to_whatsapp failed for card {card_id}: {e}")
        return api_response(status_code=502, message="Failed to send image to WhatsApp", error=str(e))

    return api_response(message="Image sent to WhatsApp")


@work_cards_bp.route('/export', methods=['GET'])
@token_required
@role_required('ADMIN')
def export_work_cards():
    """Export work card images for a site and month as a ZIP file.

    Two selection modes:
      - card_ids:     export exactly these cards (lets the user pick specific
                      cards, including multiple per employee).
      - employee_ids: legacy mode — one latest (or latest-approved) card per
                      employee. Used when card_ids is not provided.
    """
    site_id = request.args.get('site_id')
    month_str = request.args.get('month')  # YYYY-MM-DD
    card_ids_str = request.args.get('card_ids')
    employee_ids_str = request.args.get('employee_ids')
    approved_only = request.args.get('approved_only', 'true').lower() == 'true'

    if not site_id or not month_str:
        return api_response(status_code=400, message="site_id and month are required", error="Bad Request")

    if not card_ids_str and not employee_ids_str:
        return api_response(status_code=400, message="card_ids or employee_ids is required", error="Bad Request")

    try:
        month = datetime.strptime(month_str, '%Y-%m-%d').date()
    except ValueError:
        return api_response(status_code=400, message="Invalid month format. Use YYYY-MM-DD", error="Bad Request")

    if card_ids_str:
        parsed_card_ids = []
        for raw_id in [item.strip() for item in card_ids_str.split(',') if item.strip()]:
            try:
                parsed_card_ids.append(UUID(raw_id))
            except ValueError:
                return api_response(status_code=400, message="Invalid card_id format", error="Bad Request")

        if not parsed_card_ids:
            return api_response(status_code=400, message="card_ids is required", error="Bad Request")

        cards = repo.get_by_ids_for_export(
            card_ids=parsed_card_ids,
            site_id=site_id,
            month=month,
            business_id=g.business_id,
        )
    else:
        parsed_employee_ids = []
        for emp_id in [item.strip() for item in employee_ids_str.split(',') if item.strip()]:
            try:
                parsed_employee_ids.append(UUID(emp_id))
            except ValueError:
                return api_response(status_code=400, message="Invalid employee_id format", error="Bad Request")

        if not parsed_employee_ids:
            return api_response(status_code=400, message="employee_ids is required", error="Bad Request")

        cards = repo.get_latest_per_employee_for_export(
            site_id=site_id,
            month=month,
            business_id=g.business_id,
            employee_ids=parsed_employee_ids,
            approved_only=approved_only,
        )

    def safe_label(value: str) -> str:
        if not value:
            return ''
        normalized = unicodedata.normalize('NFKC', value)
        cleaned = []
        for ch in normalized:
            cat = unicodedata.category(ch)
            if cat[0] in {'L', 'N'}:
                cleaned.append(ch)
            else:
                cleaned.append('_')
        label = ''.join(cleaned).strip('_')
        label = '_'.join(filter(None, label.split('_')))
        return label

    site = db.session.query(Site).filter_by(id=site_id, business_id=g.business_id).first()
    site_label = safe_label(site.site_name) if site else str(site_id)
    folder_name = f"{site_label}_{month.strftime('%Y-%m')}_work_cards"

    zip_buffer = BytesIO()
    used_names: Set[str] = set()
    with zipfile.ZipFile(zip_buffer, 'w', zipfile.ZIP_DEFLATED) as zipf:
        for card in cards:
            if not (card.files and card.files.image_bytes):
                continue

            original_name = card.files.file_name or card.original_filename or f"{card.id}"
            safe_original = secure_filename(original_name) or str(card.id)
            extension = ''
            if '.' in safe_original:
                extension = f".{safe_original.rsplit('.', 1)[-1]}"

            if card.employee:
                id_number = card.employee.passport_id or str(card.employee.id)
                # Use only the first name in the filename.
                first_name = (card.employee.full_name or '').split()[0] if card.employee.full_name else ''
                safe_employee = safe_label(first_name) or str(card.employee.id)
                safe_id_number = safe_label(id_number) or str(card.employee.id)
                base_name = f"{safe_employee}_{safe_id_number}"
            else:
                base_name = f"unassigned_{card.id}"

            # Embed the review comment in the filename so it travels with the
            # image. Hebrew letters survive safe_label (Unicode category L).
            comment_label = safe_label(card.notes or '')[:60].strip('_')
            if comment_label:
                base_name = f"{base_name}__{comment_label}"

            # Multiple cards can now share a base name (same employee, several
            # cards). Disambiguate so zip entries never overwrite each other.
            file_name = f"{base_name}{extension}"
            if file_name in used_names:
                file_name = f"{base_name}_{card.created_at.strftime('%Y-%m-%d')}{extension}"
                suffix = 2
                while file_name in used_names:
                    file_name = f"{base_name}_{card.created_at.strftime('%Y-%m-%d')}_{suffix}{extension}"
                    suffix += 1
            used_names.add(file_name)

            file_path = f"{folder_name}/{file_name}"
            zipf.writestr(file_path, card.files.image_bytes)

    zip_buffer.seek(0)
    download_name = f"work_cards_{site_id}_{month.strftime('%Y-%m')}.zip"
    return send_file(
        zip_buffer,
        mimetype='application/zip',
        as_attachment=True,
        download_name=download_name
    )

def _serialize_day_entries_for_card(card: Any) -> list:
    """Build the merged month view of day entries for a single work card.

    Returns the card's own day entries with conflict/lock metadata relative to
    its immediate-previous sibling card, plus previous-only days appended for
    full-month context. Days that conflict with an APPROVED prior card are
    returned locked and with the approved value substituted in (source of
    truth); every other day shows the latest card's value. Pure of HTTP — the
    same logic backs both the per-card and employee-month endpoints.
    """
    entries = day_entry_repo.get_by_work_card(card.id)
    prev_by_day = _get_sibling_day_context(card)
    current_entries_by_day = {entry.day_of_month: entry for entry in entries}
    data = []

    for entry in entries:
        row = model_to_dict(entry)
        row['has_conflict'] = False
        row['conflict_type'] = None
        row['is_locked'] = False
        row['previous_work_card_id'] = None
        row['previous_work_card_status'] = None
        row['previous_entry'] = None
        row['locked_from_previous'] = False
        row['suggested_entry'] = None

        prev = prev_by_day.get(entry.day_of_month)
        if prev and not _entries_equal(entry, prev['entry']):
            previous_entry = prev['entry']
            row['has_conflict'] = True
            row['conflict_type'] = 'WITH_APPROVED' if prev['is_approved'] else 'WITH_PENDING'
            row['is_locked'] = prev['is_approved']
            row['previous_work_card_id'] = str(prev['card_id'])
            row['previous_work_card_status'] = prev['card_status']
            row['previous_entry'] = model_to_dict(previous_entry)

            if prev['is_approved']:
                row['suggested_entry'] = {
                    'from_time': _normalize_time_value(entry.from_time),
                    'to_time': _normalize_time_value(entry.to_time),
                    'total_hours': float(entry.total_hours) if entry.total_hours is not None else None,
                    'day_status': entry.day_status,
                }
                row['from_time'] = _normalize_time_value(previous_entry.from_time)
                row['to_time'] = _normalize_time_value(previous_entry.to_time)
                row['total_hours'] = float(previous_entry.total_hours) if previous_entry.total_hours is not None else None
                row['day_status'] = previous_entry.day_status
                row['attributed_site_id'] = str(previous_entry.attributed_site_id) if previous_entry.attributed_site_id else None

        data.append(row)

    # Show sibling-only days even when absent from this card so review has full-month context.
    for day, prev in prev_by_day.items():
        if day in current_entries_by_day:
            continue
        previous_entry = prev['entry']
        row = model_to_dict(previous_entry)
        row['work_card_id'] = str(card.id)
        row['source'] = (
            'LOCKED_PREVIOUS_APPROVED'
            if prev['is_approved']
            else 'PREVIOUS_CARRIED_CONTEXT'
        )
        row['has_conflict'] = False
        row['conflict_type'] = None
        row['is_locked'] = prev['is_approved']
        row['locked_from_previous'] = prev['is_approved']
        row['previous_work_card_id'] = str(prev['card_id'])
        row['previous_work_card_status'] = prev['card_status']
        row['previous_entry'] = model_to_dict(previous_entry)
        row['suggested_entry'] = None
        data.append(row)

    data.sort(key=lambda item: item.get('day_of_month') or 0)
    return data


@work_cards_bp.route('/<uuid:card_id>/day-entries', methods=['GET'])
@token_required
def get_day_entries(card_id):
    """Get all day entries for a work card (merged month view)."""
    # Verify ownership
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")

    try:
        return api_response(data=_serialize_day_entries_for_card(card))
    except Exception as e:
        return api_response(status_code=500, message="Failed to retrieve day entries", error=str(e))


def _pick_primary_card(cards: list):
    """Choose the card that owns the editable employee-month table.

    The latest non-APPROVED card wins (that's the one still being reviewed);
    if every card is approved, the latest overall. `cards` is assumed sorted
    newest-first (as get_group_cards returns).
    """
    if not cards:
        return None
    for card in cards:
        if card.review_status != 'APPROVED':
            return card
    return cards[0]


@work_cards_bp.route('/employee-month', methods=['GET'])
@token_required
def get_employee_month_group():
    """Return the merged employee-month review payload: one editable table
    (the primary card's merged day entries) plus the list of every card in the
    group so the UI can show all their images as reference."""
    employee_id_str = request.args.get('employee_id')
    month_str = request.args.get('month')
    site_id_str = request.args.get('site_id')

    if not employee_id_str or not month_str:
        return api_response(status_code=400, message="employee_id and month are required", error="Bad Request")

    try:
        employee_id = UUID(employee_id_str)
        site_id = UUID(site_id_str) if site_id_str else None
    except ValueError:
        return api_response(status_code=400, message="Invalid UUID format", error="Bad Request")

    try:
        month = datetime.strptime(month_str, '%Y-%m-%d').date()
    except ValueError:
        return api_response(status_code=400, message="Invalid month format. Use YYYY-MM-DD", error="Bad Request")

    cards = repo.get_group_cards(
        employee_id=employee_id,
        month=month,
        business_id=g.business_id,
        site_id=site_id,
    )
    if not cards:
        return api_response(status_code=404, message="No work cards found for this employee/month", error="Not Found")

    primary = _pick_primary_card(cards)

    def _card_summary(card):
        return {
            'id': str(card.id),
            'review_status': card.review_status,
            'source': card.source,
            'original_filename': card.original_filename,
            'created_at': card.created_at.isoformat() if card.created_at else None,
            'has_file': card.files is not None,
        }

    payload = {
        'primary_card_id': str(primary.id),
        'cards': [_card_summary(c) for c in cards],
        'day_entries': _serialize_day_entries_for_card(primary),
        'monthly_breakdown': compute_monthly_breakdown_payload(primary, cards),
    }
    return api_response(data=payload)


@work_cards_bp.route('/<uuid:card_id>/day-entries', methods=['PUT'])
@token_required
@role_required('ADMIN')
def update_day_entries(card_id):
    """Bulk update day entries for a work card."""
    # Verify ownership
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")
    
    data = request.get_json()
    if not data or 'entries' not in data:
        return api_response(status_code=400, message="entries array is required", error="Bad Request")

    entries_data = data['entries']
    if not isinstance(entries_data, list):
        return api_response(status_code=400, message="entries must be an array", error="Bad Request")

    # Optional top-level monthly_total_hours: a single per-month figure used when the
    # admin can't (or doesn't want to) record per-day hours. Stored on the card itself.
    monthly_total_provided = 'monthly_total_hours' in data
    monthly_total_value = None
    if monthly_total_provided:
        raw_monthly_total = data.get('monthly_total_hours')
        if raw_monthly_total in (None, ''):
            monthly_total_value = None
        else:
            try:
                monthly_total_value = round(float(raw_monthly_total), 2)
            except (TypeError, ValueError):
                return api_response(
                    status_code=400,
                    message="monthly_total_hours must be numeric",
                    error="Bad Request"
                )
            if monthly_total_value < 0:
                return api_response(
                    status_code=400,
                    message="monthly_total_hours must be non-negative",
                    error="Bad Request"
                )
    
    # Validation helper
    def validate_time_format(time_str):
        """Validate HH:MM format."""
        if time_str is None:
            return None
        if not isinstance(time_str, str):
            return False
        pattern = r'^([0-1]?[0-9]|2[0-3]):[0-5][0-9]$'
        if not re.match(pattern, time_str):
            return False
        return time_str
    
    # Validate all entries first
    validation_errors = []
    for entry in entries_data:
        errors = {}
        
        # Validate day_of_month
        day = entry.get('day_of_month')
        if day is None:
            errors['day_of_month'] = 'day_of_month is required'
        elif not isinstance(day, int) or day < 1 or day > 31:
            errors['day_of_month'] = 'day_of_month must be between 1 and 31'
        
        # Validate from_time
        from_time = entry.get('from_time')
        if from_time is not None:
            validated = validate_time_format(from_time)
            if validated is False:
                errors['from_time'] = 'from_time must be in HH:MM format'
        
        # Validate to_time
        to_time = entry.get('to_time')
        if to_time is not None:
            validated = validate_time_format(to_time)
            if validated is False:
                errors['to_time'] = 'to_time must be in HH:MM format'
        
        # Validate total_hours
        total_hours = entry.get('total_hours')
        if total_hours is not None:
            try:
                float(total_hours)
            except (ValueError, TypeError):
                errors['total_hours'] = 'total_hours must be numeric'

        # Validate day_status
        VALID_DAY_STATUSES = {'VACATION', 'SICK', 'INTERNATIONAL_VISA', 'HOLIDAY'}
        day_status = entry.get('day_status')
        if day_status is not None and day_status not in VALID_DAY_STATUSES:
            errors['day_status'] = f"Invalid day_status: {day_status}"

        if errors:
            validation_errors.append({'day': day, 'errors': errors})
    
    if validation_errors:
        return api_response(
            status_code=400,
            message="Validation errors in entries",
            error="Bad Request",
            data={'validation_errors': validation_errors}
        )

    # Resolve & validate per-day site attribution. A day may be attributed to a
    # site other than the card's own (employee transferred mid-month); the value
    # must be a real site of this business.
    card_site_id_str = str(card.site_id) if card.site_id else None
    requested_site_ids = set()
    for entry in entries_data:
        raw_site = entry.get('attributed_site_id')
        if raw_site in (None, ''):
            continue
        try:
            requested_site_ids.add(str(UUID(str(raw_site))))
        except (ValueError, AttributeError, TypeError):
            return api_response(
                status_code=400,
                message=f"Invalid attributed_site_id: {raw_site}",
                error="Bad Request",
            )
    if requested_site_ids:
        from ..repositories.site_repository import SiteRepository
        known_sites = SiteRepository().get_by_ids_for_business(
            [UUID(sid) for sid in requested_site_ids], g.business_id
        )
        unknown = requested_site_ids - {str(s.id) for s in known_sites}
        if unknown:
            return api_response(
                status_code=400,
                message=f"attributed_site_id not found for this business: {', '.join(sorted(unknown))}",
                error="Bad Request",
            )

    try:
        # Update or create entries
        updated_entries = []
        for entry in entries_data:
            day = entry['day_of_month']

            # Get existing entry for this day
            existing = day_entry_repo.get_by_day(card_id, day)

            day_status = entry.get('day_status')

            # When a status is set, clear time/hours; otherwise parse normally
            if day_status:
                from_time_obj = None
                to_time_obj = None
                total_hours_val = None
            else:
                from_time_obj = None
                to_time_obj = None

                if entry.get('from_time'):
                    hour, minute = map(int, entry['from_time'].split(':'))
                    from_time_obj = time(hour, minute)

                if entry.get('to_time'):
                    hour, minute = map(int, entry['to_time'].split(':'))
                    to_time_obj = time(hour, minute)

                total_hours_val = entry.get('total_hours')
                if total_hours_val is None and from_time_obj is not None and to_time_obj is not None:
                    delta_minutes = (to_time_obj.hour * 60 + to_time_obj.minute) - \
                                    (from_time_obj.hour * 60 + from_time_obj.minute)
                    if delta_minutes < 0:
                        delta_minutes += 24 * 60
                    total_hours_val = round(delta_minutes / 60.0, 2)

            entry_data = {
                'from_time': from_time_obj,
                'to_time': to_time_obj,
                'total_hours': total_hours_val,
                'day_status': day_status,
                'updated_by_user_id': g.current_user.id
            }

            if entry.get('is_override'):
                entry_data['source'] = 'MANUAL_OVERRIDE'

            # Store NULL when the attribution equals the card's own site (the
            # default) or is unset, so the column only ever holds genuine
            # cross-site overrides. Always set it so reverting to default clears
            # a previously-stored override.
            raw_site = entry.get('attributed_site_id')
            if raw_site not in (None, '') and str(raw_site) != card_site_id_str:
                entry_data['attributed_site_id'] = UUID(str(raw_site))
            else:
                entry_data['attributed_site_id'] = None

            if existing:
                # Update existing entry
                updated = day_entry_repo.update_entry(existing.id, g.current_user.id, **entry_data)
                updated_entries.append(updated)
            else:
                # Create new entry
                entry_data['work_card_id'] = card_id
                entry_data['day_of_month'] = day
                if 'source' not in entry_data:
                    entry_data['source'] = 'MANUAL'
                new_entry = day_entry_repo.create(**entry_data)
                updated_entries.append(new_entry)

        # Persist monthly_total_hours on the card itself when supplied.
        if monthly_total_provided:
            card.monthly_total_hours = monthly_total_value

        # Editing an approved card un-approves it: the admin must re-approve to
        # re-commit the new values. Without this, saves to an approved card
        # would silently overwrite "locked" data with no review gate.
        flipped_to_review = unapprove_card_on_edit(
            card,
            had_any_change=bool(updated_entries) or monthly_total_provided,
        )

        if monthly_total_provided or flipped_to_review:
            db.session.commit()

        return api_response(
            data=models_to_list(updated_entries),
            message="Day entries updated successfully",
            meta={'card_review_status': card.review_status}
        )
    except Exception as e:
        return api_response(status_code=500, message="Failed to update day entries", error=str(e))

@work_cards_bp.route('/upload/single', methods=['POST'])
@token_required
def upload_single():
    """Upload a single work card for a known employee."""
    # Define allowed MIME types
    ALLOWED_TYPES = {
        'image/jpeg',
        'image/jpg', 
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf'
    }
    
    # Validate form data
    if 'file' not in request.files:
        return api_response(status_code=400, message="No file provided", error="Bad Request")
    
    file = request.files['file']
    if file.filename == '':
        return api_response(status_code=400, message="No file selected", error="Bad Request")
    
    # Validate MIME type
    content_type = file.content_type or 'application/octet-stream'
    if content_type not in ALLOWED_TYPES:
        return api_response(
            status_code=400, 
            message="סוג קובץ לא נתמך. אנא העלה קובץ תמונה או PDF בלבד", 
            error="Invalid file type"
        )
    
    site_id = request.form.get('site_id')
    employee_id = request.form.get('employee_id')
    processing_month = request.form.get('processing_month')
    
    if not site_id or not employee_id or not processing_month:
        return api_response(status_code=400, message="site_id, employee_id, and processing_month are required", error="Bad Request")
    
    try:
        # Parse processing_month
        month = datetime.strptime(processing_month, '%Y-%m-%d').date()

        # Read file data
        file_data = file.read()
        filename = secure_filename(file.filename)

        if content_type == 'application/pdf':
            # Store raw PDF and let the worker split it — keeps heavy libs off the web dyno
            work_card = repo.create(
                business_id=g.business_id,
                site_id=site_id,
                employee_id=employee_id,
                processing_month=month,
                source='ADMIN_SINGLE',
                uploaded_by_user_id=g.current_user.id,
                original_filename=filename,
                mime_type='application/pdf',
                file_size_bytes=len(file_data),
                source_page_number=None,
                source_page_position=None,
                review_status='SPLITTING',
            )
            file_repo.create(
                work_card_id=work_card.id,
                content_type='application/pdf',
                file_name=filename,
                image_bytes=file_data,
            )
            extraction_repo.create(
                work_card_id=work_card.id,
                status='PENDING_SPLIT',
            )
        else:
            # Image: store directly and queue for extraction
            work_card = repo.create(
                business_id=g.business_id,
                site_id=site_id,
                employee_id=employee_id,
                processing_month=month,
                source='ADMIN_SINGLE',
                uploaded_by_user_id=g.current_user.id,
                original_filename=filename,
                mime_type=content_type,
                file_size_bytes=len(file_data),
                source_page_number=None,
                source_page_position=None,
                review_status='NEEDS_REVIEW',
            )
            file_repo.create(
                work_card_id=work_card.id,
                content_type=content_type,
                file_name=filename,
                image_bytes=file_data,
            )
            extraction_repo.create(
                work_card_id=work_card.id,
                status='PENDING',
            )

        return api_response(
            data=model_to_dict(work_card),
            message="Work card uploaded successfully",
            status_code=201
        )
    except ValueError as e:
        return api_response(status_code=400, message="Invalid date format. Use YYYY-MM-DD", error=str(e))
    except Exception as e:
        return api_response(status_code=500, message="Failed to upload work card", error=str(e))

@work_cards_bp.route('/<uuid:card_id>/extract', methods=['POST'])
@token_required
@role_required('ADMIN')
def trigger_extraction(card_id):
    """Trigger (or re-trigger) extraction for a work card."""
    # Verify ownership
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")
    
    try:
        # Get existing extraction job
        extraction = extraction_repo.get_by_work_card(card_id)
        
        if extraction:
            # Reset existing job to PENDING (will be picked up by worker)
            extraction_repo.reset_job(extraction.id)
            extraction = extraction_repo.get_by_id(extraction.id)  # Refresh
            message = "Extraction re-triggered successfully"
        else:
            # Create new extraction job
            extraction = extraction_repo.create(
                work_card_id=card_id,
                status='PENDING'
            )
            message = "Extraction triggered successfully"
        
        return api_response(
            data=model_to_dict(extraction),
            message=message
        )
    except Exception as e:
        return api_response(status_code=500, message="Failed to trigger extraction", error=str(e))


@work_cards_bp.route('/<uuid:card_id>/reextract-hours', methods=['POST'])
@token_required
@role_required('ADMIN')
def reextract_hours(card_id):
    """Re-trigger extraction for hours only, preserving the existing employee assignment."""
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")

    try:
        extraction = extraction_repo.get_by_work_card(card_id)

        if extraction:
            # Delete existing day entries so fresh ones are written by the worker
            day_entry_repo.delete_by_work_card(card_id)
            extraction_repo.reset_job_hours_only(extraction.id)
            extraction = extraction_repo.get_by_id(extraction.id)
            message = "Hours re-extraction triggered successfully"
        else:
            # No prior extraction — create a new HOURS_ONLY job
            extraction = extraction_repo.create(
                work_card_id=card_id,
                status='PENDING',
                extraction_mode='HOURS_ONLY',
            )
            message = "Hours extraction triggered successfully"

        return api_response(data=model_to_dict(extraction), message=message)
    except Exception as e:
        return api_response(status_code=500, message="Failed to trigger hours re-extraction", error=str(e))


@work_cards_bp.route('/<uuid:card_id>/extraction', methods=['GET'])
@token_required
def get_extraction_status(card_id):
    """Get the extraction status for a work card."""
    # Verify ownership
    card = repo.get_by_id(card_id)
    if not card or card.business_id != g.business_id:
        return api_response(status_code=404, message="Work card not found", error="Not Found")
    
    try:
        extraction = extraction_repo.get_by_work_card(card_id)
        
        if not extraction:
            return api_response(status_code=404, message="No extraction found for this work card", error="Not Found")
        
        return api_response(data=model_to_dict(extraction))
    except Exception as e:
        return api_response(status_code=500, message="Failed to get extraction status", error=str(e))


@work_cards_bp.route('/upload/batch', methods=['POST'])
@token_required
def upload_batch():
    """Upload multiple work cards for unknown employees (bulk upload)."""
    # Define allowed MIME types
    ALLOWED_TYPES = {
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf'
    }
    
    # Validate files
    if 'files' not in request.files:
        return api_response(status_code=400, message="No files provided", error="Bad Request")
    
    files = request.files.getlist('files')
    if not files or len(files) == 0:
        return api_response(status_code=400, message="No files selected", error="Bad Request")
    
    site_id = request.form.get('site_id')
    processing_month = request.form.get('processing_month')
    
    if not site_id or not processing_month:
        return api_response(status_code=400, message="site_id and processing_month are required", error="Bad Request")
    
    try:
        # Parse processing_month
        month = datetime.strptime(processing_month, '%Y-%m-%d').date()
        
        uploaded = []
        failed = []
        
        for file in files:
            if file.filename == '':
                continue
            
            # Validate MIME type for each file
            content_type = file.content_type or 'application/octet-stream'
            if content_type not in ALLOWED_TYPES:
                failed.append({
                    'filename': file.filename,
                    'error': 'סוג קובץ לא נתמך. אנא העלה קובץ תמונה או PDF בלבד'
                })
                continue
                
            try:
                file_data = file.read()
                filename = secure_filename(file.filename)

                if content_type == 'application/pdf':
                    # Store raw PDF and let the worker split it
                    work_card = repo.create(
                        business_id=g.business_id,
                        site_id=site_id,
                        employee_id=None,
                        processing_month=month,
                        source='ADMIN_BATCH',
                        uploaded_by_user_id=g.current_user.id,
                        original_filename=filename,
                        mime_type='application/pdf',
                        file_size_bytes=len(file_data),
                        source_page_number=None,
                        source_page_position=None,
                        review_status='SPLITTING',
                    )
                    file_repo.create(
                        work_card_id=work_card.id,
                        content_type='application/pdf',
                        file_name=filename,
                        image_bytes=file_data,
                    )
                    extraction_repo.create(
                        work_card_id=work_card.id,
                        status='PENDING_SPLIT',
                    )
                    uploaded.append({
                        'filename': filename,
                        'work_card_id': str(work_card.id),
                        'page_number': None,
                        'page_position': None,
                    })
                else:
                    # Image: store directly and queue for extraction
                    work_card = repo.create(
                        business_id=g.business_id,
                        site_id=site_id,
                        employee_id=None,
                        processing_month=month,
                        source='ADMIN_BATCH',
                        uploaded_by_user_id=g.current_user.id,
                        original_filename=filename,
                        mime_type=content_type,
                        file_size_bytes=len(file_data),
                        source_page_number=None,
                        source_page_position=None,
                        review_status='NEEDS_ASSIGNMENT',
                    )
                    file_repo.create(
                        work_card_id=work_card.id,
                        content_type=content_type,
                        file_name=filename,
                        image_bytes=file_data,
                    )
                    extraction_repo.create(
                        work_card_id=work_card.id,
                        status='PENDING',
                    )
                    uploaded.append({
                        'filename': filename,
                        'work_card_id': str(work_card.id),
                        'page_number': None,
                        'page_position': None,
                    })
            except Exception as e:
                failed.append({
                    'filename': file.filename,
                    'error': str(e)
                })

        if uploaded:
            from .dashboard import invalidate_business_cache
            invalidate_business_cache(g.business_id)
        return api_response(
            data={
                'uploaded': uploaded,
                'failed': failed,
                'summary': {
                    'total': len(files),
                    'uploaded': len(uploaded),
                    'failed': len(failed)
                }
            },
            message=f"Batch upload completed: {len(uploaded)} uploaded, {len(failed)} failed",
            status_code=201
        )
    except ValueError as e:
        return api_response(status_code=400, message="Invalid date format. Use YYYY-MM-DD", error=str(e))
    except Exception as e:
        return api_response(status_code=500, message="Failed to process batch upload", error=str(e))


@work_cards_bp.route('/upload/siteless-batch', methods=['POST'])
@token_required
def upload_siteless_batch():
    """Upload multiple work cards without a site — site is derived from matched employee."""
    ALLOWED_TYPES = {
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf'
    }

    if 'files' not in request.files:
        return api_response(status_code=400, message="No files provided", error="Bad Request")

    files = request.files.getlist('files')
    if not files or len(files) == 0:
        return api_response(status_code=400, message="No files selected", error="Bad Request")

    processing_month = request.form.get('processing_month')
    if not processing_month:
        return api_response(status_code=400, message="processing_month is required", error="Bad Request")

    try:
        month = datetime.strptime(processing_month, '%Y-%m-%d').date()

        uploaded = []
        failed = []

        for file in files:
            if file.filename == '':
                continue

            content_type = file.content_type or 'application/octet-stream'
            if content_type not in ALLOWED_TYPES:
                failed.append({
                    'filename': file.filename,
                    'error': 'סוג קובץ לא נתמך. אנא העלה קובץ תמונה או PDF בלבד'
                })
                continue

            try:
                file_data = file.read()
                filename = secure_filename(file.filename)

                if content_type == 'application/pdf':
                    # Store raw PDF and let the worker split it
                    work_card = repo.create(
                        business_id=g.business_id,
                        site_id=None,
                        employee_id=None,
                        processing_month=month,
                        source='ADMIN_BATCH',
                        uploaded_by_user_id=g.current_user.id,
                        original_filename=filename,
                        mime_type='application/pdf',
                        file_size_bytes=len(file_data),
                        source_page_number=None,
                        source_page_position=None,
                        review_status='SPLITTING',
                    )
                    file_repo.create(
                        work_card_id=work_card.id,
                        content_type='application/pdf',
                        file_name=filename,
                        image_bytes=file_data,
                    )
                    extraction_repo.create(
                        work_card_id=work_card.id,
                        status='PENDING_SPLIT',
                    )
                    uploaded.append({
                        'filename': filename,
                        'work_card_id': str(work_card.id),
                        'page_number': None,
                        'page_position': None,
                    })
                else:
                    # Image: store directly and queue for extraction
                    work_card = repo.create(
                        business_id=g.business_id,
                        site_id=None,
                        employee_id=None,
                        processing_month=month,
                        source='ADMIN_BATCH',
                        uploaded_by_user_id=g.current_user.id,
                        original_filename=filename,
                        mime_type=content_type,
                        file_size_bytes=len(file_data),
                        source_page_number=None,
                        source_page_position=None,
                        review_status='NEEDS_ASSIGNMENT',
                    )
                    file_repo.create(
                        work_card_id=work_card.id,
                        content_type=content_type,
                        file_name=filename,
                        image_bytes=file_data,
                    )
                    extraction_repo.create(
                        work_card_id=work_card.id,
                        status='PENDING',
                    )
                    uploaded.append({
                        'filename': filename,
                        'work_card_id': str(work_card.id),
                        'page_number': None,
                        'page_position': None,
                    })
            except Exception as e:
                failed.append({'filename': file.filename, 'error': str(e)})

        if uploaded:
            from .dashboard import invalidate_business_cache
            invalidate_business_cache(g.business_id)
        return api_response(
            data={
                'uploaded': uploaded,
                'failed': failed,
                'summary': {
                    'total': len(files),
                    'uploaded': len(uploaded),
                    'failed': len(failed),
                },
            },
            message=f"Siteless batch upload completed: {len(uploaded)} uploaded, {len(failed)} failed",
            status_code=201,
        )
    except ValueError as e:
        return api_response(status_code=400, message="Invalid date format. Use YYYY-MM-DD", error=str(e))
    except Exception as e:
        return api_response(status_code=500, message="Failed to process siteless batch upload", error=str(e))



@work_cards_bp.route('/unassigned', methods=['GET'])
@token_required
def get_unassigned_work_cards():
    """Return paginated unassigned work cards (no employee) for the current business."""
    from datetime import date as date_type

    month_str = request.args.get('month')
    page = int(request.args.get('page', 1))
    page_size = int(request.args.get('page_size', 20))

    month = None
    if month_str:
        try:
            month = datetime.strptime(month_str, '%Y-%m-%d').date()
        except ValueError:
            return api_response(status_code=400, message="Invalid month format. Use YYYY-MM-DD", error="Bad Request")

    try:
        result = repo.get_unassigned_cards(
            business_id=g.business_id,
            month=month,
            page=page,
            page_size=page_size,
        )

        items_data = []
        for card in result['items']:
            card_dict = model_to_dict(card)
            if card.extraction:
                card_dict['extraction'] = model_to_dict(card.extraction)
            items_data.append(card_dict)

        return api_response(data={
            'items': items_data,
            'total': result['total'],
            'page': result['page'],
            'page_size': result['page_size'],
        })
    except Exception as e:
        return api_response(status_code=500, message="Failed to fetch unassigned work cards", error=str(e))


@work_cards_bp.route('/reset', methods=['DELETE'])
@token_required
@role_required('APPLICATION_MANAGER')
def reset_work_cards():
    """Bulk-delete work cards for a business+month, optionally scoped to a single site.

    Body JSON:
        business_id (str, required)
        month       (str, required)  — "YYYY-MM"
        site_id     (str, optional)  — omit to delete all sites for that business+month
    """
    from ..repositories.business_repository import BusinessRepository
    from ..repositories.site_repository import SiteRepository
    import uuid as uuid_module

    data = request.get_json()
    if not data:
        return api_response(status_code=400, message="No data provided", error="Bad Request")

    business_id_str = data.get('business_id')
    month_str = data.get('month')
    site_id_str = data.get('site_id')

    if not business_id_str:
        return api_response(status_code=400, message="business_id is required", error="Bad Request")
    if not month_str:
        return api_response(status_code=400, message="month is required", error="Bad Request")

    try:
        business_id = uuid_module.UUID(business_id_str)
    except ValueError:
        return api_response(status_code=400, message="Invalid business_id format", error="Bad Request")

    # Parse "YYYY-MM" into a date (first day of the month)
    try:
        month = datetime.strptime(month_str, '%Y-%m').date()
    except ValueError:
        try:
            month = datetime.strptime(month_str, '%Y-%m-%d').date()
        except ValueError:
            return api_response(status_code=400, message="Invalid month format. Use YYYY-MM", error="Bad Request")

    # Validate business exists
    biz_repo = BusinessRepository()
    if not biz_repo.get_by_id(business_id):
        return api_response(status_code=404, message="Business not found", error="Not Found")

    site_id = None
    if site_id_str:
        try:
            site_id = uuid_module.UUID(site_id_str)
        except ValueError:
            return api_response(status_code=400, message="Invalid site_id format", error="Bad Request")

        # Validate site belongs to this business
        site_repo_inst = SiteRepository()
        site = site_repo_inst.get_by_id(site_id)
        if not site or str(site.business_id) != str(business_id):
            return api_response(status_code=404, message="Site not found for this business", error="Not Found")

    try:
        from ..models.audit import AuditEvent
        from ..models.telegram import TelegramIngestedFile
        from ..models.whatsapp import WhatsAppIngestedMessage

        if site_id:
            cards = repo.get_by_site_month(site_id=site_id, month=month, business_id=business_id)
        else:
            cards = repo.get_by_business_month(business_id=business_id, month=month)

        card_ids = [card.id for card in cards]

        if card_ids:
            db.session.query(AuditEvent).filter(AuditEvent.work_card_id.in_(card_ids)).update(
                {AuditEvent.work_card_id: None}, synchronize_session=False
            )
            db.session.query(TelegramIngestedFile).filter(TelegramIngestedFile.work_card_id.in_(card_ids)).update(
                {TelegramIngestedFile.work_card_id: None}, synchronize_session=False
            )
            db.session.query(WhatsAppIngestedMessage).filter(WhatsAppIngestedMessage.work_card_id.in_(card_ids)).update(
                {WhatsAppIngestedMessage.work_card_id: None}, synchronize_session=False
            )

        deleted_count = 0
        for card in cards:
            db.session.delete(card)
            deleted_count += 1

        db.session.commit()
        return api_response(data={'deleted_count': deleted_count}, message=f"Deleted {deleted_count} work cards")
    except Exception as e:
        db.session.rollback()
        logger.exception("Failed to reset work cards")
        return api_response(status_code=500, message="Failed to reset work cards", error=str(e))
