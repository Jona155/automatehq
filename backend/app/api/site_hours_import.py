import calendar
import logging
from datetime import date
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple
from uuid import UUID

from flask import Blueprint, g, request
from openpyxl import load_workbook

from ..auth_utils import token_required, role_required
from ..extensions import db
from ..models.sites import Site
from ..models.work_cards import WorkCard
from ..repositories.employee_repository import EmployeeRepository
from ..repositories.work_card_day_entry_repository import WorkCardDayEntryRepository
from ..repositories.work_card_repository import WorkCardRepository
from .sites import STATUS_DAY_LABELS
from .utils import api_response

logger = logging.getLogger(__name__)

site_hours_import_bp = Blueprint('site_hours_import', __name__, url_prefix='/api/sites')

_employee_repo = EmployeeRepository()
_work_card_repo = WorkCardRepository()
_day_entry_repo = WorkCardDayEntryRepository()

LABEL_TO_STATUS: Dict[str, str] = {v: k for k, v in STATUS_DAY_LABELS.items()}
_SATURDAY_LABEL = 'שבת'
_ALLOWED_STRINGS = set(LABEL_TO_STATUS.keys()) | {_SATURDAY_LABEL}

_CARD_STATUS_ORDER = ['APPROVED', 'NEEDS_REVIEW', 'PENDING', 'REJECTED']


def _best_card(a: WorkCard, b: WorkCard) -> WorkCard:
    rank_a = _CARD_STATUS_ORDER.index(a.review_status) if a.review_status in _CARD_STATUS_ORDER else 99
    rank_b = _CARD_STATUS_ORDER.index(b.review_status) if b.review_status in _CARD_STATUS_ORDER else 99
    if rank_b < rank_a:
        return b
    if rank_a < rank_b:
        return a
    # same rank → prefer most recent
    return a if (a.created_at or 0) >= (b.created_at or 0) else b


@site_hours_import_bp.route('/<site_id>/hours-import', methods=['POST'])
@token_required
@role_required('ADMIN')
def import_hours_from_excel(site_id: str):
    user = g.current_user

    # --- month param ---
    month_str = (request.args.get('month') or '').strip()
    try:
        year, month = (int(p) for p in month_str.split('-'))
        month_date = date(year, month, 1)
    except (ValueError, AttributeError):
        return api_response(status_code=400, message="פרמטר month לא תקין (נדרש YYYY-MM)", error="Bad Request")

    days_in_month = calendar.monthrange(year, month)[1]

    # --- file ---
    if 'file' not in request.files:
        return api_response(status_code=400, message="לא נבחר קובץ", error="Bad Request")
    f = request.files['file']
    if not f.filename or not f.filename.lower().endswith('.xlsx'):
        return api_response(status_code=400, message="יש להעלות קובץ בפורמט XLSX בלבד", error="Bad Request")
    file_bytes = f.read()

    # --- site ---
    try:
        site_uuid = UUID(site_id)
    except ValueError:
        return api_response(status_code=400, message="מזהה אתר לא תקין", error="Bad Request")
    site = db.session.query(Site).filter_by(id=site_uuid, business_id=g.business_id).first()
    if not site:
        return api_response(status_code=404, message="אתר לא נמצא", error="Not Found")

    # --- parse workbook ---
    try:
        wb = load_workbook(BytesIO(file_bytes), data_only=True)
    except Exception:
        return api_response(status_code=400, message="הקובץ אינו קובץ Excel תקין", error="Bad Request")
    ws = wb.active

    # --- structure: A1 must be "יום בחודש" ---
    if str(ws.cell(row=1, column=1).value or '').strip() != 'יום בחודש':
        return api_response(
            status_code=400,
            message="מבנה הקובץ אינו תואם את הפורמט הנדרש (ציפייה ל'יום בחודש' בתא A1)",
            error="Bad Request",
        )

    # --- collect employee columns from row 1 (B+) ---
    passport_cols: List[Tuple[int, str]] = []
    col = 2
    while True:
        v = ws.cell(row=1, column=col).value
        if v is None or str(v).strip() == '':
            break
        passport_cols.append((col, str(v).strip()))
        col += 1

    if not passport_cols:
        return api_response(status_code=400, message="לא נמצאו עמודות עובדים בקובץ", error="Bad Request")

    employee_count = len(passport_cols)

    # --- validate day structure (rows 3-33, col A) ---
    structure_errors: List[Dict[str, Any]] = []
    for day in range(1, 32):
        cell_val = ws.cell(row=day + 2, column=1).value
        raw = str(cell_val or '').strip()
        # _format_day_label produces "7-שבת" style; extract numeric prefix
        day_num_str = raw.split('-')[0]
        try:
            day_num = int(day_num_str)
        except ValueError:
            structure_errors.append({
                "type": "structure",
                "message": f"שורה {day + 2} (יום {day}): ערך לא תקין בעמודת ימים ({raw!r})",
            })
            continue
        if day_num != day:
            structure_errors.append({
                "type": "structure",
                "message": f"שורה {day + 2}: ציפייה ליום {day}, נמצא {day_num}",
            })

    if structure_errors:
        return api_response(
            status_code=400,
            message="מבנה הקובץ אינו תואם (עמודת הימים)",
            error="Bad Request",
            data={"validation_errors": structure_errors},
        )

    # --- validate tariff (row 36, column employee_count+2) ---
    tariff_errors: List[Dict[str, Any]] = []
    value_col = employee_count + 2
    tariff_cell = ws.cell(row=36, column=value_col).value
    excel_tariff: Optional[float] = None
    if tariff_cell is not None:
        try:
            excel_tariff = float(tariff_cell)
        except (ValueError, TypeError):
            pass

    site_tariff: Optional[float] = float(site.hourly_tariff) if site.hourly_tariff is not None else None

    if site_tariff is not None and excel_tariff is not None:
        if abs(excel_tariff - site_tariff) > 0.01:
            tariff_errors.append({
                "type": "tariff_mismatch",
                "message": (
                    f"התעריף בקובץ ({excel_tariff:.2f} ₪) שונה מהתעריף המוגדר לאתר ({site_tariff:.2f} ₪)"
                ),
            })
    elif site_tariff is None and excel_tariff is not None:
        tariff_errors.append({
            "type": "tariff_mismatch",
            "message": f"הקובץ מכיל תעריף ({excel_tariff:.2f} ₪) אך לאתר לא מוגדר תעריף",
        })

    # --- validate employees ---
    site_employees = _employee_repo.get_by_site(site_uuid, g.business_id)
    site_passport_map: Dict[str, Any] = {
        (e.passport_id or '').strip(): e
        for e in site_employees
        if e.passport_id
    }

    employee_errors: List[Dict[str, Any]] = []
    valid_cols: List[Tuple[int, str, Any]] = []  # (col_index, passport, employee)
    for col_idx, passport in passport_cols:
        employee = site_passport_map.get(passport)
        if not employee:
            employee_errors.append({
                "type": "unknown_employee",
                "message": f"עובד עם דרכון {passport} לא נמצא באתר זה",
                "passport": passport,
            })
        else:
            valid_cols.append((col_idx, passport, employee))

    # --- validate cell values ---
    cell_errors: List[Dict[str, Any]] = []
    for col_idx, passport, _ in valid_cols:
        for day in range(1, 32):
            cell_val = ws.cell(row=day + 2, column=col_idx).value
            if cell_val is None:
                continue
            if isinstance(cell_val, (int, float)):
                # Numeric hours beyond the month's days
                if day > days_in_month and cell_val != 0:
                    cell_errors.append({
                        "type": "invalid_day",
                        "message": f"יום {day} אינו קיים בחודש זה אך מכיל שעות לעובד {passport}",
                        "passport": passport,
                        "day": day,
                    })
            elif isinstance(cell_val, str):
                stripped = cell_val.strip()
                if stripped and stripped not in _ALLOWED_STRINGS:
                    cell_errors.append({
                        "type": "unrecognized_value",
                        "message": f"ערך לא מוכר '{stripped}' לעובד {passport} ביום {day}",
                        "passport": passport,
                        "day": day,
                        "value": stripped,
                    })

    all_errors = tariff_errors + employee_errors + cell_errors
    if all_errors:
        return api_response(
            status_code=400,
            message="הקובץ מכיל שגיאות ולא יובא",
            error="Bad Request",
            data={"validation_errors": all_errors},
        )

    # --- apply ---
    existing_cards = _work_card_repo.get_by_site_month(site_uuid, month_date, g.business_id)
    cards_by_employee: Dict[UUID, WorkCard] = {}
    for card in existing_cards:
        emp_id = card.employee_id
        if emp_id not in cards_by_employee:
            cards_by_employee[emp_id] = card
        else:
            cards_by_employee[emp_id] = _best_card(cards_by_employee[emp_id], card)

    updated_cards = 0
    updated_entries = 0
    employee_summaries: List[Dict[str, Any]] = []

    try:
        for col_idx, passport, employee in valid_cols:
            emp_id = employee.id

            work_card = cards_by_employee.get(emp_id)
            if work_card is None:
                work_card = _work_card_repo.create(
                    business_id=g.business_id,
                    site_id=site_uuid,
                    employee_id=emp_id,
                    processing_month=month_date,
                    source='MANUAL',
                    uploaded_by_user_id=user.id,
                    review_status='NEEDS_REVIEW',
                )
                cards_by_employee[emp_id] = work_card

            card_id = work_card.id

            # Pre-load existing entries for this card
            existing_entries = _day_entry_repo.get_by_work_card(card_id)
            entries_by_day: Dict[int, Any] = {e.day_of_month: e for e in existing_entries}

            card_entries_changed = 0
            for day in range(1, days_in_month + 1):
                cell_val = ws.cell(row=day + 2, column=col_idx).value

                new_total_hours: Optional[float] = None
                new_day_status: Optional[str] = None

                if isinstance(cell_val, (int, float)):
                    new_total_hours = float(cell_val)
                elif isinstance(cell_val, str):
                    stripped = cell_val.strip()
                    if stripped in LABEL_TO_STATUS:
                        new_day_status = LABEL_TO_STATUS[stripped]
                    # empty string or שבת → both None (clear)

                existing_entry = entries_by_day.get(day)
                if existing_entry:
                    _day_entry_repo.update_entry(
                        existing_entry.id,
                        user.id,
                        total_hours=new_total_hours,
                        day_status=new_day_status,
                        from_time=None,
                        to_time=None,
                    )
                    card_entries_changed += 1
                elif new_total_hours is not None or new_day_status is not None:
                    _day_entry_repo.create(
                        work_card_id=card_id,
                        day_of_month=day,
                        total_hours=new_total_hours,
                        day_status=new_day_status,
                        source='MANUAL_IMPORT',
                        is_valid=True,
                        updated_by_user_id=user.id,
                    )
                    card_entries_changed += 1

            updated_cards += 1
            updated_entries += card_entries_changed
            employee_summaries.append({
                "passport": passport,
                "name": employee.full_name,
                "work_card_id": str(work_card.id),
                "entries_changed": card_entries_changed,
            })

        return api_response(
            status_code=200,
            message=f"ייבוא הושלם בהצלחה: עודכנו {updated_cards} כרטיסי עבודה ו-{updated_entries} רשומות יום",
            data={
                "updated_cards": updated_cards,
                "updated_entries": updated_entries,
                "employees": employee_summaries,
            },
        )

    except Exception:
        logger.exception("Failed to apply hours import for site %s month %s", site_id, month_str)
        db.session.rollback()
        return api_response(status_code=500, message="שגיאה פנימית בעדכון הנתונים", error="Internal Server Error")
