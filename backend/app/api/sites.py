from flask import Blueprint, request, g, send_file
import os
import uuid
import traceback
import logging
import re
from datetime import datetime, timedelta, timezone
import secrets
import csv
import calendar
from io import BytesIO, StringIO
import unicodedata
from pathlib import Path
from copy import copy
from openpyxl import load_workbook
from openpyxl.utils import get_column_letter
from sqlalchemy import and_, or_, func, case
from sqlalchemy.orm import joinedload
from twilio.rest import Client
from ..repositories.site_repository import SiteRepository
from ..repositories.employee_repository import EmployeeRepository
from ..repositories.upload_access_request_repository import UploadAccessRequestRepository
from ..services.sites.hours_matrix_service import (
    build_employee_upload_status_map,
    get_latest_work_card_with_extraction_by_employee,
)
from .utils import api_response, model_to_dict, models_to_list
from ..auth_utils import token_required
from ..utils import normalize_phone
from ..models.work_cards import WorkCard, WorkCardExtraction, WorkCardDayEntry
from ..models.sites import Employee
from ..extensions import db

logger = logging.getLogger(__name__)

sites_bp = Blueprint('sites', __name__, url_prefix='/api/sites')
repo = SiteRepository()
employee_repo = EmployeeRepository()
access_repo = UploadAccessRequestRepository()

STATUS_LABELS = {
    'APPROVED': 'מאושר',
    'NEEDS_REVIEW': 'ממתין לסקירה',
    'NEEDS_ASSIGNMENT': 'ממתין לשיוך',
    'REJECTED': 'נדחה',
    'NO_UPLOAD': 'ללא העלאה',
}

def _generate_access_token():
    token = None
    for _ in range(5):
        candidate = secrets.token_urlsafe(32)
        if not access_repo.token_exists(candidate):
            token = candidate
            break
    return token

def _format_whatsapp_number(raw_phone: str):
    if not raw_phone:
        return None
    if raw_phone.startswith('0'):
        return '+972' + raw_phone[1:]
    return '+' + raw_phone

def _build_access_link_url(token: str):
    return f"{request.host_url.rstrip('/')}/portal/{token}"

def _safe_label(value: str) -> str:
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

def _safe_sheet_name(value: str, existing: set) -> str:
    if not value:
        base = 'Site'
    else:
        base = value
    invalid = ['\\', '/', '*', '[', ']', ':', '?']
    for ch in invalid:
        base = base.replace(ch, ' ')
    base = ' '.join(base.split()).strip()
    if not base:
        base = 'Site'
    base = base[:31]
    candidate = base
    counter = 2
    while candidate in existing:
        suffix = f" {counter}"
        candidate = (base[:31 - len(suffix)] + suffix).rstrip()
        counter += 1
    existing.add(candidate)
    return candidate

def _resolve_summary_template_path() -> Path:
    """Resolve the Excel template used for batch site export."""
    base_dir = Path(__file__).resolve().parents[2]
    templates_dir = base_dir / 'excel_extraction_example'
    preferred = templates_dir / 'שעות עבודה לפי אתרים ינואר 26 (1).xlsx'
    if preferred.exists():
        return preferred

    candidates = sorted(templates_dir.glob('*.xlsx'))
    if not candidates:
        raise FileNotFoundError('No Excel template found in backend/excel_extraction_example')
    return candidates[0]

def _resolve_salary_template_path(month_date) -> Path:
    """Resolve salary export template for a month from employee_sheet_extraction."""
    root_dir = Path(__file__).resolve().parents[3]
    templates_dir = root_dir / 'employee_sheet_extraction'
    if not templates_dir.exists():
        raise FileNotFoundError('Template folder employee_sheet_extraction was not found')

    month_token = f"{month_date.month:02d}_{month_date.year}"
    month_candidates = []
    generic_candidates = []

    for candidate in sorted(templates_dir.glob('*.xlsx')):
        stem = candidate.stem.lower()
        if 'worker_new_hours_template' not in stem:
            continue
        generic_candidates.append(candidate)
        if month_token in stem or f"{month_date.month}_{month_date.year}" in stem:
            month_candidates.append(candidate)

    if month_candidates:
        return month_candidates[-1]
    if generic_candidates:
        return generic_candidates[-1]

    raise FileNotFoundError(
        f'No salary template found in {templates_dir} for {month_date.strftime("%Y-%m")}'
    )


def _extract_salary_day_columns_map(ws, month_date):
    """
    Parse row-1 day headers in salary template and return {day_number: column_index}.
    Expected header format per day column: "D.MM", e.g. "1.02".
    """
    day_columns = {}
    observed_months = set()
    pattern = re.compile(r'^\s*(\d{1,2})\.(\d{1,2})\s*$')

    for col in range(2, ws.max_column + 1):
        value = ws.cell(row=1, column=col).value
        if value is None:
            continue
        match = pattern.match(str(value))
        if not match:
            continue
        day = int(match.group(1))
        month = int(match.group(2))
        if day < 1 or day > 31:
            continue
        observed_months.add(month)
        day_columns[day] = col

    if not day_columns:
        raise ValueError('Invalid salary template format: missing day columns on header row')
    return day_columns


def _copy_salary_column_template(ws, source_col, target_col):
    """Copy style and width from one column to another across the worksheet."""
    source_letter = get_column_letter(source_col)
    target_letter = get_column_letter(target_col)
    ws.column_dimensions[target_letter].width = ws.column_dimensions[source_letter].width

    for row in range(1, ws.max_row + 1):
        source_cell = ws.cell(row=row, column=source_col)
        target_cell = ws.cell(row=row, column=target_col)
        target_cell._style = copy(source_cell._style)
        target_cell.number_format = source_cell.number_format
        target_cell.font = copy(source_cell.font)
        target_cell.fill = copy(source_cell.fill)
        target_cell.border = copy(source_cell.border)
        target_cell.alignment = copy(source_cell.alignment)
        target_cell.protection = copy(source_cell.protection)
        target_cell.value = source_cell.value


def _ensure_salary_template_month_columns(ws, month_date):
    """
    Ensure the salary sheet day columns match the requested month:
    - adjust number of day columns (insert/delete at the end of the day range)
    - rewrite header values to D.MM for requested month
    """
    parsed = _extract_salary_day_columns_map(ws, month_date)
    day_start_col = min(parsed.values())
    existing_days = max(parsed.keys())
    target_days = calendar.monthrange(month_date.year, month_date.month)[1]

    if existing_days < target_days:
        cols_to_add = target_days - existing_days
        insert_at = day_start_col + existing_days
        ws.insert_cols(insert_at, cols_to_add)
        for offset in range(cols_to_add):
            col_index = insert_at + offset
            _copy_salary_column_template(ws, insert_at - 1, col_index)
    elif existing_days > target_days:
        delete_start = day_start_col + target_days
        delete_count = existing_days - target_days
        ws.delete_cols(delete_start, delete_count)

    day_columns = {}
    for day in range(1, target_days + 1):
        col = day_start_col + day - 1
        ws.cell(row=1, column=col, value=f'{day}.{month_date.month:02d}')
        day_columns[day] = col
    return day_columns


def _find_salary_instruction_row(ws):
    """Find first row that starts the instructions block (contains 'הוראות' in column A)."""
    for row in range(2, ws.max_row + 1):
        cell_value = ws.cell(row=row, column=1).value
        if cell_value is None:
            continue
        if 'הוראות' in str(cell_value):
            return row
    raise ValueError('Invalid salary template format: could not find instructions row')


def _copy_salary_row_template(ws, source_row, target_row):
    """Copy style and baseline values from one template row to another."""
    for col in range(1, ws.max_column + 1):
        source_cell = ws.cell(row=source_row, column=col)
        target_cell = ws.cell(row=target_row, column=col)
        target_cell._style = copy(source_cell._style)
        target_cell.number_format = source_cell.number_format
        target_cell.font = copy(source_cell.font)
        target_cell.fill = copy(source_cell.fill)
        target_cell.border = copy(source_cell.border)
        target_cell.alignment = copy(source_cell.alignment)
        target_cell.protection = copy(source_cell.protection)
        target_cell.value = source_cell.value

    ws.row_dimensions[target_row].height = ws.row_dimensions[source_row].height


def _populate_salary_template_sheet(ws, employees, matrix, month_date):
    """
    Populate salary template:
    - Row 1 remains as header (passport/day columns).
    - Employee rows start at row 2 and continue until instructions row.
    - Column A contains employee passport/ID.
    - Day columns contain numeric hours when available, otherwise remain blank
      (except prefilled 'שבת' values are preserved).
    """
    ws.sheet_view.rightToLeft = True
    day_columns = _ensure_salary_template_month_columns(ws, month_date)
    days_in_month = calendar.monthrange(month_date.year, month_date.month)[1]
    employee_start_row = 2
    instruction_row = _find_salary_instruction_row(ws)
    base_template_row = max(employee_start_row, instruction_row - 1)
    available_rows = max(0, instruction_row - employee_start_row)
    needed_rows = len(employees)

    if needed_rows > available_rows:
        rows_to_insert = needed_rows - available_rows
        ws.insert_rows(instruction_row, rows_to_insert)
        for row in range(instruction_row, instruction_row + rows_to_insert):
            _copy_salary_row_template(ws, base_template_row, row)
        instruction_row += rows_to_insert

    def clear_row(row_index):
        ws.cell(row=row_index, column=1, value=None)
        for day, col in day_columns.items():
            cell = ws.cell(row=row_index, column=col)
            is_saturday = day <= days_in_month and datetime(month_date.year, month_date.month, day).weekday() == 5
            cell.value = 'שבת' if is_saturday else None

    for idx, employee in enumerate(employees):
        row_index = employee_start_row + idx
        employee_id_value = (employee.passport_id or '').strip() if employee.passport_id else ''
        ws.cell(row=row_index, column=1, value=employee_id_value)

        employee_days = matrix.get(str(employee.id), {})
        for day, col in day_columns.items():
            hours = employee_days.get(day)
            cell = ws.cell(row=row_index, column=col)
            if hours is None:
                is_saturday = day <= days_in_month and datetime(month_date.year, month_date.month, day).weekday() == 5
                cell.value = 'שבת' if is_saturday else None
            else:
                cell.value = round(float(hours), 2)

    for row_index in range(employee_start_row + needed_rows, instruction_row):
        clear_row(row_index)


def _sort_employees_for_export(employees):
    return sorted(
        employees,
        key=lambda e: (
            (e.full_name or '').strip().lower(),
            (e.passport_id or '').strip().lower(),
            str(e.id)
        )
    )


def _format_day_label(year: int, month: int, day: int, days_in_month: int):
    if day <= days_in_month and datetime(year, month, day).weekday() == 5:
        return f'{day}-שבת'
    return day


def _day_fallback_value(year: int, month: int, day: int, days_in_month: int):
    if day > days_in_month:
        return None
    if datetime(year, month, day).weekday() == 5:
        return 'שבת'
    return None


def _populate_template_core_sheet(
    ws,
    employees,
    matrix,
    month_date,
    style_header,
    style_body,
    style_total,
):
    """Populate a worksheet in the core template format (no fee summary rows)."""
    days_in_month = calendar.monthrange(month_date.year, month_date.month)[1]
    employee_count = len(employees)
    last_data_col = max(2, employee_count + 1)

    # Clear template values (including fee/footer cells) while preserving worksheet settings.
    clear_max_col = max(last_data_col, ws.max_column)
    for row in range(1, 39):
        for col in range(1, clear_max_col + 1):
            ws.cell(row=row, column=col).value = None

    ws.sheet_view.rightToLeft = True

    ws.cell(row=1, column=1, value='יום בחודש')._style = copy(style_header)
    ws.cell(row=2, column=1, value=None)._style = copy(style_body)

    for idx, employee in enumerate(employees, start=2):
        passport_value = (employee.passport_id or '').strip() if employee.passport_id else ''
        ws.cell(row=1, column=idx, value=passport_value)._style = copy(style_header)
        ws.cell(row=2, column=idx, value=employee.full_name or '')._style = copy(style_body)

    # Body rows: fixed 31-day structure (rows 3..33)
    for day in range(1, 32):
        row = day + 2
        ws.cell(
            row=row,
            column=1,
            value=_format_day_label(month_date.year, month_date.month, day, days_in_month)
        )._style = copy(style_body)

        for idx, employee in enumerate(employees, start=2):
            employee_days = matrix.get(str(employee.id), {})
            value = employee_days.get(day)
            if value is None:
                value = _day_fallback_value(month_date.year, month_date.month, day, days_in_month)
            ws.cell(row=row, column=idx, value=value)._style = copy(style_body)

    ws.cell(row=34, column=1, value='סה"כ')._style = copy(style_total)
    for col in range(2, last_data_col + 1):
        col_letter = get_column_letter(col)
        ws.cell(row=34, column=col, value=f'=SUM({col_letter}3:{col_letter}33)')._style = copy(style_total)

def _load_hours_matrix(site_id, processing_month, approved_only, include_inactive):
    month = datetime.strptime(processing_month, '%Y-%m-%d').date()

    if include_inactive:
        employees = employee_repo.get_by_site(site_id, g.business_id)
    else:
        employees = employee_repo.get_active_by_site(site_id, g.business_id)

    matrix = {}
    status_map = {}

    ranked_cards = db.session.query(
        WorkCard.id.label('work_card_id'),
        WorkCard.employee_id,
        WorkCard.review_status,
        func.row_number().over(
            partition_by=WorkCard.employee_id,
            order_by=[
                case(
                    (WorkCard.review_status == 'APPROVED', 1),
                    else_=2
                ),
                WorkCard.created_at.desc()
            ]
        ).label('rank')
    ).filter(
        WorkCard.business_id == g.business_id,
        WorkCard.site_id == site_id,
        WorkCard.processing_month == month,
        WorkCard.employee_id.isnot(None)
    )

    if approved_only:
        ranked_cards = ranked_cards.filter(WorkCard.review_status == 'APPROVED')

    ranked_cards = ranked_cards.subquery()

    best_cards = db.session.query(
        ranked_cards.c.work_card_id
    ).filter(
        ranked_cards.c.rank == 1
    ).subquery()

    day_entries = db.session.query(
        WorkCardDayEntry.work_card_id,
        WorkCardDayEntry.day_of_month,
        WorkCardDayEntry.total_hours
    ).join(
        WorkCard,
        WorkCard.id == WorkCardDayEntry.work_card_id
    ).filter(
        WorkCardDayEntry.work_card_id.in_(db.session.query(best_cards.c.work_card_id))
    ).all()

    work_card_to_employee = {}
    cards_query = db.session.query(
        WorkCard.id,
        WorkCard.employee_id,
        WorkCard.review_status
    ).filter(
        WorkCard.id.in_(db.session.query(best_cards.c.work_card_id))
    ).all()

    for card_id, employee_id, review_status in cards_query:
        employee_id_str = str(employee_id)
        work_card_to_employee[str(card_id)] = employee_id_str
        status_map[employee_id_str] = review_status

    for entry in day_entries:
        work_card_id_str = str(entry.work_card_id)
        employee_id = work_card_to_employee.get(work_card_id_str)

        if employee_id:
            if employee_id not in matrix:
                matrix[employee_id] = {}

            if entry.total_hours is not None:
                matrix[employee_id][entry.day_of_month] = float(entry.total_hours)

    employees = _sort_employees_for_export(employees)
    return employees, matrix, status_map, month

@sites_bp.route('', methods=['GET'])
@token_required
def get_sites():
    """Get all sites, optionally with employee counts, scoped to tenant."""
    try:
        include_counts = request.args.get('include_counts', 'false').lower() == 'true'
        only_active = request.args.get('active', 'false').lower() == 'true'
        
        # Always scope to current business
        business_id = g.business_id
        
        if include_counts:
            if only_active:
                results = repo.get_active_with_employee_count(business_id)
            else:
                results = repo.get_with_employee_count(business_id)
                
            data = []
            for item in results:
                site_dict = model_to_dict(item['site'])
                site_dict['employee_count'] = item['employee_count']
                data.append(site_dict)
        else:
            if only_active:
                sites = repo.get_active_sites(business_id)
            else:
                sites = repo.get_all(filters={'business_id': business_id})
            data = models_to_list(sites)
            
        return api_response(data=data)
    except Exception as e:
        logger.exception("Failed to get sites")
        traceback.print_exc()
        return api_response(status_code=500, message="Failed to get sites", error=str(e))

@sites_bp.route('', methods=['POST'])
@token_required
def create_site():
    """Create a new site, scoped to tenant."""
    data = request.get_json()
    if not data:
        return api_response(status_code=400, message="No data provided", error="Bad Request")
        
    try:
        # Enforce tenant scoping
        data['business_id'] = g.business_id
        
        # Validation
        if not data.get('site_name'):
            return api_response(status_code=400, message="Site name is required", error="Bad Request")
        
        # Check if site with name exists within tenant
        existing = repo.get_by_name_and_business(data['site_name'], g.business_id)
        if existing:
             return api_response(status_code=409, message="Site with this name already exists", error="Conflict")

        site = repo.create(**data)
        return api_response(data=model_to_dict(site), message="Site created successfully", status_code=201)
    except Exception as e:
        logger.exception("Failed to create site")
        traceback.print_exc()
        return api_response(status_code=500, message="Failed to create site", error=str(e))

@sites_bp.route('/<uuid:site_id>', methods=['GET'])
@token_required
def get_site(site_id):
    """Get a specific site by ID, scoped to tenant."""
    try:
        site = repo.get_by_id(site_id)
        if not site or site.business_id != g.business_id:
            return api_response(status_code=404, message="Site not found", error="Not Found")
            
        return api_response(data=model_to_dict(site))
    except Exception as e:
        logger.exception(f"Failed to get site {site_id}")
        traceback.print_exc()
        return api_response(status_code=500, message="Failed to get site", error=str(e))

@sites_bp.route('/<uuid:site_id>', methods=['PUT'])
@token_required
def update_site(site_id):
    """Update a site, scoped to tenant."""
    data = request.get_json()
    if not data:
        return api_response(status_code=400, message="No data provided", error="Bad Request")
        
    try:
        # Verify site belongs to user's business
        site = repo.get_by_id(site_id)
        if not site or site.business_id != g.business_id:
            return api_response(status_code=404, message="Site not found", error="Not Found")
        
        # Don't allow changing business_id
        data.pop('business_id', None)

        if 'responsible_employee_id' in data:
            responsible_employee_id = data.get('responsible_employee_id')
            if not responsible_employee_id:
                data['responsible_employee_id'] = None
            else:
                try:
                    responsible_employee_uuid = uuid.UUID(str(responsible_employee_id))
                except ValueError:
                    return api_response(status_code=400, message="Invalid responsible_employee_id format", error="Bad Request")

                employee = employee_repo.get_by_id(responsible_employee_uuid)
                if not employee or employee.business_id != g.business_id or str(employee.site_id) != str(site_id):
                    return api_response(status_code=404, message="Responsible employee not found for this site", error="Not Found")
                if not employee.is_active:
                    return api_response(status_code=400, message="Responsible employee is not active", error="Bad Request")

                data['responsible_employee_id'] = responsible_employee_uuid
        
        updated_site = repo.update(site_id, **data)
        if not updated_site:
            return api_response(status_code=404, message="Site not found", error="Not Found")
            
        return api_response(data=model_to_dict(updated_site), message="Site updated successfully")
    except Exception as e:
        logger.exception(f"Failed to update site {site_id}")
        traceback.print_exc()
        return api_response(status_code=500, message="Failed to update site", error=str(e))

@sites_bp.route('/<uuid:site_id>', methods=['DELETE'])
@token_required
def delete_site(site_id):
    """Delete a site, scoped to tenant."""
    try:
        # Verify site belongs to user's business
        site = repo.get_by_id(site_id)
        if not site or site.business_id != g.business_id:
            return api_response(status_code=404, message="Site not found", error="Not Found")
        
        # We might want to just mark as inactive instead of deleting if there are related records
        # But BaseRepository.delete does a hard delete. 
        # For now, let's assume hard delete is requested, but catch FK errors
        success = repo.delete(site_id)
        if not success:
            return api_response(status_code=404, message="Site not found", error="Not Found")
            
        return api_response(message="Site deleted successfully")
    except Exception as e:
        logger.exception(f"Failed to delete site {site_id}")
        traceback.print_exc()
        return api_response(status_code=500, message="Failed to delete site", error=str(e))

@sites_bp.route('/<uuid:site_id>/employee-upload-status', methods=['GET'])
@token_required
def get_employee_upload_status(site_id):
    """Get employee upload status for a site and month."""
    # Verify site belongs to user's business
    site = repo.get_by_id(site_id)
    if not site or site.business_id != g.business_id:
        return api_response(status_code=404, message="Site not found", error="Not Found")
    
    processing_month = request.args.get('processing_month')
    if not processing_month:
        return api_response(status_code=400, message="processing_month is required", error="Bad Request")
    
    try:
        # Parse processing_month
        month = datetime.strptime(processing_month, '%Y-%m-%d').date()
        
        employee_rows = get_latest_work_card_with_extraction_by_employee(
            business_id=g.business_id,
            site_id=site_id,
            processing_month=month,
        )
        status_map = build_employee_upload_status_map(employee_rows)

        result = []
        for employee, _, _, _ in employee_rows:
            employee_status = status_map.get(str(employee.id), {'status': 'NO_UPLOAD', 'work_card_id': None})
            employee_dict = model_to_dict(employee)
            result.append({
                'employee': employee_dict,
                'status': employee_status['status'],
                'work_card_id': employee_status['work_card_id'],
            })
        
        return api_response(data=result)
    except ValueError as e:
        return api_response(status_code=400, message="Invalid date format. Use YYYY-MM-DD", error=str(e))
    except Exception as e:
        logger.exception(f"Failed to get employee upload status for site {site_id}")
        traceback.print_exc()
        return api_response(status_code=500, message="Failed to get employee upload status", error=str(e))

@sites_bp.route('/<uuid:site_id>/matrix', methods=['GET'])
@token_required
def get_hours_matrix(site_id):
    """Get hours matrix for a site and month with performance optimization."""
    # Verify site belongs to user's business
    site = repo.get_by_id(site_id)
    if not site or site.business_id != g.business_id:
        return api_response(status_code=404, message="Site not found", error="Not Found")
    
    processing_month = request.args.get('processing_month')
    if not processing_month:
        return api_response(status_code=400, message="processing_month is required", error="Bad Request")
    
    approved_only = request.args.get('approved_only', 'true').lower() == 'true'
    include_inactive = request.args.get('include_inactive', 'false').lower() == 'true'
    
    try:
        employees, matrix, status_map, _ = _load_hours_matrix(
            site_id,
            processing_month,
            approved_only,
            include_inactive
        )

        return api_response(data={
            'employees': models_to_list(employees),
            'matrix': matrix,
            'status_map': status_map
        })
    except ValueError as e:
        return api_response(status_code=400, message="Invalid date format. Use YYYY-MM-DD", error=str(e))
    except Exception as e:
        logger.exception(f"Failed to get hours matrix for site {site_id}")
        traceback.print_exc()
        return api_response(status_code=500, message="Failed to get hours matrix", error=str(e))

@sites_bp.route('/<uuid:site_id>/summary/export', methods=['GET'])
@token_required
def export_monthly_summary(site_id):
    """Export monthly summary matrix as a CSV file."""
    site = repo.get_by_id(site_id)
    if not site or site.business_id != g.business_id:
        return api_response(status_code=404, message="Site not found", error="Not Found")

    processing_month = request.args.get('processing_month')
    if not processing_month:
        return api_response(status_code=400, message="processing_month is required", error="Bad Request")

    approved_only = request.args.get('approved_only', 'false').lower() == 'true'
    include_inactive = request.args.get('include_inactive', 'false').lower() == 'true'

    try:
        employees, matrix, status_map, month = _load_hours_matrix(
            site_id,
            processing_month,
            approved_only,
            include_inactive
        )
    except ValueError as e:
        return api_response(status_code=400, message="Invalid date format. Use YYYY-MM-DD", error=str(e))
    except Exception as e:
        logger.exception(f"Failed to export hours matrix for site {site_id}")
        traceback.print_exc()
        return api_response(status_code=500, message="Failed to export summary", error=str(e))

    days_in_month = calendar.monthrange(month.year, month.month)[1]
    day_headers = [str(day) for day in range(1, days_in_month + 1)]
    headers = ['employee_name', 'employee_id', 'status', *day_headers, 'total_hours']

    csv_buffer = StringIO()
    writer = csv.writer(csv_buffer)
    writer.writerow(headers)

    for employee in employees:
        employee_id_str = str(employee.id)
        employee_days = matrix.get(employee_id_str, {})
        total_hours = sum(employee_days.values()) if employee_days else 0
        status_key = status_map.get(employee_id_str) or 'NO_UPLOAD'
        status_label = STATUS_LABELS.get(status_key, status_key)

        day_values = []
        for day in range(1, days_in_month + 1):
            hours = employee_days.get(day)
            if hours is None:
                day_values.append('')
            else:
                day_values.append(f"{hours:.1f}")

        writer.writerow([
            employee.full_name,
            employee_id_str,
            status_label,
            *day_values,
            f"{total_hours:.1f}" if total_hours > 0 else ''
        ])

    day_totals = []
    for day in range(1, days_in_month + 1):
        day_total = sum(matrix.get(str(employee.id), {}).get(day, 0) for employee in employees)
        day_totals.append(f"{day_total:.1f}" if day_total > 0 else '')

    grand_total = sum(
        matrix.get(str(employee.id), {}).get(day, 0)
        for employee in employees
        for day in range(1, days_in_month + 1)
    )

    writer.writerow(['TOTAL', '', '', *day_totals, f"{grand_total:.1f}" if grand_total > 0 else ''])

    csv_bytes = csv_buffer.getvalue().encode('utf-8-sig')
    output = BytesIO(csv_bytes)
    output.seek(0)

    site_label = _safe_label(site.site_name) or str(site_id)
    download_name = f"monthly_summary_{site_label}_{month.strftime('%Y-%m')}.csv"

    return send_file(
        output,
        mimetype='text/csv',
        as_attachment=True,
        download_name=download_name
    )

@sites_bp.route('/summary/export-batch', methods=['GET'])
@token_required
def export_monthly_summary_batch():
    """Export monthly summary matrix for all sites in template format (one sheet per site)."""
    processing_month = request.args.get('processing_month')
    if not processing_month:
        return api_response(status_code=400, message="processing_month is required", error="Bad Request")

    approved_only = request.args.get('approved_only', 'false').lower() == 'true'
    include_inactive = request.args.get('include_inactive', 'false').lower() == 'true'
    include_inactive_sites = request.args.get('include_inactive_sites', 'false').lower() == 'true'

    try:
        month = datetime.strptime(processing_month, '%Y-%m-%d').date()
    except ValueError as e:
        return api_response(status_code=400, message="Invalid date format. Use YYYY-MM-DD", error=str(e))

    sites = repo.get_all_for_business(g.business_id)
    if not include_inactive_sites:
        sites = [site for site in sites if site.is_active]
    sites = sorted(
        sites,
        key=lambda s: (
            (s.site_name or '').strip().lower(),
            (s.site_code or '').strip().lower(),
            str(s.id)
        )
    )

    try:
        template_path = _resolve_summary_template_path()
        workbook = load_workbook(template_path)
    except Exception as e:
        logger.exception("Failed to load summary export template")
        return api_response(status_code=500, message="Failed to load export template", error=str(e))

    template_ws = workbook.worksheets[0]
    style_header = copy(template_ws['B1']._style)
    style_body = copy(template_ws['B3']._style)
    style_total = copy(template_ws['A34']._style)

    for ws in workbook.worksheets[1:]:
        workbook.remove(ws)

    used_sheet_names = set()
    for site in sites:
        try:
            employees, matrix, _, _ = _load_hours_matrix(
                site.id,
                processing_month,
                approved_only,
                include_inactive
            )
        except Exception:
            logger.exception(f"Failed to build summary for site {site.id}")
            continue

        ws = workbook.copy_worksheet(template_ws)
        ws.title = _safe_sheet_name(site.site_name, used_sheet_names)
        _populate_template_core_sheet(
            ws,
            employees,
            matrix,
            month,
            style_header=style_header,
            style_body=style_body,
            style_total=style_total,
        )

    if workbook.worksheets and len(workbook.worksheets) > 1:
        workbook.remove(template_ws)
    else:
        _populate_template_core_sheet(
            template_ws,
            [],
            {},
            month,
            style_header=style_header,
            style_body=style_body,
            style_total=style_total,
        )
        template_ws.title = 'Sites'

    output = BytesIO()
    workbook.save(output)
    output.seek(0)

    download_name = f"monthly_summary_all_sites_{month.strftime('%Y-%m')}.xlsx"
    return send_file(
        output,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        as_attachment=True,
        download_name=download_name
    )

@sites_bp.route('/<uuid:site_id>/salary-template/export', methods=['GET'])
@token_required
def export_salary_template_site(site_id):
    """Export salary template workbook for a single site."""
    site = repo.get_by_id(site_id)
    if not site or site.business_id != g.business_id:
        return api_response(status_code=404, message="Site not found", error="Not Found")

    processing_month = request.args.get('processing_month')
    if not processing_month:
        return api_response(status_code=400, message="processing_month is required", error="Bad Request")

    include_inactive = request.args.get('include_inactive', 'false').lower() == 'true'

    try:
        month = datetime.strptime(processing_month, '%Y-%m-%d').date()
    except ValueError as e:
        return api_response(status_code=400, message="Invalid date format. Use YYYY-MM-DD", error=str(e))

    try:
        employees, matrix, _, _ = _load_hours_matrix(
            site_id,
            processing_month,
            approved_only=False,
            include_inactive=include_inactive
        )

        template_path = _resolve_salary_template_path(month)
        workbook = load_workbook(template_path)
        ws = workbook.worksheets[0]
        _populate_salary_template_sheet(ws, employees, matrix, month)
        ws.title = _safe_sheet_name(site.site_name, set())
    except ValueError as e:
        return api_response(status_code=500, message="Invalid salary template format", error=str(e))
    except Exception as e:
        logger.exception(f"Failed to export salary template for site {site_id}")
        return api_response(status_code=500, message="Failed to export salary template", error=str(e))

    output = BytesIO()
    workbook.save(output)
    output.seek(0)

    site_label = _safe_label(site.site_name) or str(site.id)
    download_name = f"salary_template_{site_label}_{month.strftime('%Y-%m')}.xlsx"
    return send_file(
        output,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        as_attachment=True,
        download_name=download_name
    )

@sites_bp.route('/salary-template/export-batch', methods=['GET'])
@token_required
def export_salary_template_batch():
    """Export salary template workbook for all sites (one sheet per site)."""
    processing_month = request.args.get('processing_month')
    if not processing_month:
        return api_response(status_code=400, message="processing_month is required", error="Bad Request")

    include_inactive = request.args.get('include_inactive', 'false').lower() == 'true'
    include_inactive_sites = request.args.get('include_inactive_sites', 'false').lower() == 'true'

    try:
        month = datetime.strptime(processing_month, '%Y-%m-%d').date()
    except ValueError as e:
        return api_response(status_code=400, message="Invalid date format. Use YYYY-MM-DD", error=str(e))

    sites = repo.get_all_for_business(g.business_id)
    if not include_inactive_sites:
        sites = [site for site in sites if site.is_active]
    sites = sorted(
        sites,
        key=lambda s: (
            (s.site_name or '').strip().lower(),
            (s.site_code or '').strip().lower(),
            str(s.id)
        )
    )

    try:
        template_path = _resolve_salary_template_path(month)
        workbook = load_workbook(template_path)
    except Exception as e:
        logger.exception("Failed to load salary export template")
        return api_response(status_code=500, message="Failed to load salary template", error=str(e))

    template_ws = workbook.worksheets[0]
    for ws in workbook.worksheets[1:]:
        workbook.remove(ws)

    used_sheet_names = set()
    populated_count = 0
    for site in sites:
        try:
            employees, matrix, _, _ = _load_hours_matrix(
                site.id,
                processing_month,
                approved_only=False,
                include_inactive=include_inactive
            )
        except Exception:
            logger.exception(f"Failed to build salary matrix for site {site.id}")
            continue

        ws = workbook.copy_worksheet(template_ws)
        ws.title = _safe_sheet_name(site.site_name, used_sheet_names)
        try:
            _populate_salary_template_sheet(ws, employees, matrix, month)
            populated_count += 1
        except ValueError as e:
            logger.exception(f"Invalid salary template format for site {site.id}")
            return api_response(status_code=500, message="Invalid salary template format", error=str(e))

    if populated_count > 0 and len(workbook.worksheets) > 1:
        workbook.remove(template_ws)
    else:
        try:
            _populate_salary_template_sheet(template_ws, [], {}, month)
            template_ws.title = 'Sites'
        except ValueError as e:
            return api_response(status_code=500, message="Invalid salary template format", error=str(e))

    output = BytesIO()
    workbook.save(output)
    output.seek(0)

    download_name = f"salary_template_all_sites_{month.strftime('%Y-%m')}.xlsx"
    return send_file(
        output,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        as_attachment=True,
        download_name=download_name
    )


@sites_bp.route('/<uuid:site_id>/access-link', methods=['POST'])
@token_required
def create_access_link(site_id):
    data = request.get_json() or {}
    employee_id = data.get('employee_id')
    processing_month = data.get('processing_month')

    if not employee_id or not processing_month:
        return api_response(status_code=400, message="employee_id and processing_month are required", error="Bad Request")

    site = repo.get_by_id(site_id)
    if not site or site.business_id != g.business_id:
        return api_response(status_code=404, message="Site not found", error="Not Found")

    employee = employee_repo.get_by_id(employee_id)
    if not employee or employee.business_id != g.business_id or str(employee.site_id) != str(site_id):
        return api_response(status_code=404, message="Employee not found for this site", error="Not Found")
    if not employee.is_active:
        return api_response(status_code=400, message="Employee is not active", error="Bad Request")

    try:
        month = datetime.strptime(processing_month, '%Y-%m-%d').date()
    except ValueError as e:
        return api_response(status_code=400, message="Invalid date format. Use YYYY-MM-DD", error=str(e))

    # Generate unique token
    token = _generate_access_token()
    if not token:
        return api_response(status_code=500, message="Failed to generate access token", error="Server Error")

    expires_at = datetime.now(timezone.utc) + timedelta(days=30)

    access_request = access_repo.create(
        token=token,
        business_id=g.business_id,
        site_id=site_id,
        employee_id=employee_id,
        processing_month=month,
        created_by_user_id=g.current_user.id,
        expires_at=expires_at,
        is_active=True
    )

    url = _build_access_link_url(token)
    data = model_to_dict(access_request)
    data['url'] = url
    data['employee_name'] = employee.full_name

    return api_response(data=data, message="Access link created", status_code=201)


@sites_bp.route('/<uuid:site_id>/access-links', methods=['GET'])
@token_required
def list_access_links(site_id):
    site = repo.get_by_id(site_id)
    if not site or site.business_id != g.business_id:
        return api_response(status_code=404, message="Site not found", error="Not Found")

    links = access_repo.list_active_for_site(site_id, g.business_id)
    data = []
    for link in links:
        link_dict = model_to_dict(link)
        employee = employee_repo.get_by_id(link.employee_id)
        link_dict['employee_name'] = employee.full_name if employee else ''
        link_dict['url'] = f"{request.host_url.rstrip('/')}/portal/{link.token}"
        data.append(link_dict)

    return api_response(data=data)


@sites_bp.route('/<uuid:site_id>/access-link/<uuid:request_id>/whatsapp', methods=['POST'])
@token_required
def send_whatsapp_link(site_id, request_id):
    """Send an access link via WhatsApp to the employee."""
    site = repo.get_by_id(site_id)
    if not site or site.business_id != g.business_id:
        return api_response(status_code=404, message="Site not found", error="Not Found")

    access_request = access_repo.get_by_id(request_id)
    if not access_request or access_request.business_id != g.business_id:
        return api_response(status_code=404, message="Access link not found", error="Not Found")

    employee = employee_repo.get_by_id(access_request.employee_id)
    if not employee or not employee.phone_number:
        return api_response(status_code=400, message="Employee has no phone number", error="Bad Request")

    raw_phone = normalize_phone(employee.phone_number)
    if not raw_phone:
        return api_response(status_code=400, message="Invalid phone number format", error="Bad Request")

    formatted_phone = _format_whatsapp_number(raw_phone)
    if not formatted_phone:
        return api_response(status_code=400, message="Invalid phone number format", error="Bad Request")

    try:
        account_sid = os.environ.get('TWILIO_ACCOUNT_SID')
        auth_token = os.environ.get('TWILIO_AUTH_TOKEN')
        from_number = os.environ.get('TWILIO_WHATSAPP_NUMBER')

        if not all([account_sid, auth_token, from_number]):
            logger.error("Twilio credentials missing")
            return api_response(status_code=500, message="Server configuration error", error="Twilio config missing")

        client = Client(account_sid, auth_token)

        url = _build_access_link_url(access_request.token)
        message_body = (
            f"שלום {employee.full_name},\n"
            f"להלן הקישור להעלאת כרטיסי העבודה עבור חודש {access_request.processing_month.strftime('%m/%Y')}:\n"
            f"{url}"
        )

        message = client.messages.create(
            from_=from_number,
            body=message_body,
            to=f"whatsapp:{formatted_phone}"
        )

        logger.info(f"WhatsApp sent to {formatted_phone}: {message.sid}")
        return api_response(message="WhatsApp sent successfully")

    except Exception as e:
        logger.exception(f"Twilio error for request {request_id}")
        return api_response(status_code=500, message="Failed to send WhatsApp message", error=str(e))


@sites_bp.route('/access-links/whatsapp-batch', methods=['POST'])
@token_required
def send_whatsapp_links_batch():
    """Create access links and send them via WhatsApp for multiple sites."""
    payload = request.get_json() or {}
    site_ids = payload.get('site_ids') or []
    processing_month = payload.get('processing_month')

    if not site_ids or not isinstance(site_ids, list):
        return api_response(status_code=400, message="site_ids must be a non-empty list", error="Bad Request")
    if not processing_month:
        return api_response(status_code=400, message="processing_month is required", error="Bad Request")

    try:
        month = datetime.strptime(processing_month, '%Y-%m-%d').date()
    except ValueError as e:
        return api_response(status_code=400, message="Invalid date format. Use YYYY-MM-DD", error=str(e))

    account_sid = os.environ.get('TWILIO_ACCOUNT_SID')
    auth_token = os.environ.get('TWILIO_AUTH_TOKEN')
    from_number = os.environ.get('TWILIO_WHATSAPP_NUMBER')
    if not all([account_sid, auth_token, from_number]):
        logger.error("Twilio credentials missing")
        return api_response(status_code=500, message="Server configuration error", error="Twilio config missing")

    client = Client(account_sid, auth_token)

    results = []
    sent_count = 0
    failed_count = 0
    skipped_count = 0

    for site_id in site_ids:
        site_id_str = str(site_id)
        site = None
        try:
            site_uuid = uuid.UUID(site_id_str)
        except ValueError:
            skipped_count += 1
            results.append({
                'site_id': site_id_str,
                'status': 'skipped',
                'reason': 'Invalid site_id format'
            })
            continue

        site = repo.get_by_id(site_uuid)
        if not site or site.business_id != g.business_id:
            skipped_count += 1
            results.append({
                'site_id': site_id_str,
                'status': 'skipped',
                'reason': 'Site not found'
            })
            continue

        if not site.responsible_employee_id:
            skipped_count += 1
            results.append({
                'site_id': site_id_str,
                'site_name': site.site_name,
                'status': 'skipped',
                'reason': 'No responsible employee'
            })
            continue

        employee = employee_repo.get_by_id(site.responsible_employee_id)
        if not employee or employee.business_id != g.business_id or str(employee.site_id) != str(site.id):
            skipped_count += 1
            results.append({
                'site_id': site_id_str,
                'site_name': site.site_name,
                'employee_id': str(site.responsible_employee_id),
                'status': 'skipped',
                'reason': 'Responsible employee not found for site'
            })
            continue

        if not employee.is_active:
            skipped_count += 1
            results.append({
                'site_id': site_id_str,
                'site_name': site.site_name,
                'employee_id': str(employee.id),
                'employee_name': employee.full_name,
                'status': 'skipped',
                'reason': 'Responsible employee is not active'
            })
            continue

        if not employee.phone_number:
            skipped_count += 1
            results.append({
                'site_id': site_id_str,
                'site_name': site.site_name,
                'employee_id': str(employee.id),
                'employee_name': employee.full_name,
                'status': 'skipped',
                'reason': 'Employee has no phone number'
            })
            continue

        raw_phone = normalize_phone(employee.phone_number)
        if not raw_phone:
            skipped_count += 1
            results.append({
                'site_id': site_id_str,
                'site_name': site.site_name,
                'employee_id': str(employee.id),
                'employee_name': employee.full_name,
                'status': 'skipped',
                'reason': 'Invalid phone number format'
            })
            continue

        formatted_phone = _format_whatsapp_number(raw_phone)
        if not formatted_phone:
            skipped_count += 1
            results.append({
                'site_id': site_id_str,
                'site_name': site.site_name,
                'employee_id': str(employee.id),
                'employee_name': employee.full_name,
                'status': 'skipped',
                'reason': 'Invalid phone number format'
            })
            continue

        token = _generate_access_token()
        if not token:
            failed_count += 1
            results.append({
                'site_id': site_id_str,
                'site_name': site.site_name,
                'employee_id': str(employee.id),
                'employee_name': employee.full_name,
                'status': 'failed',
                'reason': 'Failed to generate access token'
            })
            continue

        expires_at = datetime.now(timezone.utc) + timedelta(days=30)

        access_request = access_repo.create(
            token=token,
            business_id=g.business_id,
            site_id=site.id,
            employee_id=employee.id,
            processing_month=month,
            created_by_user_id=g.current_user.id,
            expires_at=expires_at,
            is_active=True
        )

        url = _build_access_link_url(token)
        message_body = (
            f"שלום {employee.full_name},\n"
            f"להלן הקישור להעלאת כרטיסי העבודה עבור חודש {month.strftime('%m/%Y')}:\n"
            f"{url}"
        )

        try:
            message = client.messages.create(
                from_=from_number,
                body=message_body,
                to=f"whatsapp:{formatted_phone}"
            )
            logger.info(f"WhatsApp sent to {formatted_phone}: {message.sid}")
            sent_count += 1
            results.append({
                'site_id': site_id_str,
                'site_name': site.site_name,
                'employee_id': str(employee.id),
                'employee_name': employee.full_name,
                'request_id': str(access_request.id),
                'status': 'sent'
            })
        except Exception as e:
            logger.exception(f"Twilio error for site {site.id}")
            failed_count += 1
            results.append({
                'site_id': site_id_str,
                'site_name': site.site_name,
                'employee_id': str(employee.id),
                'employee_name': employee.full_name,
                'request_id': str(access_request.id),
                'status': 'failed',
                'reason': str(e)
            })

    return api_response(data={
        'total_requested': len(site_ids),
        'processing_month': processing_month,
        'sent_count': sent_count,
        'failed_count': failed_count,
        'skipped_count': skipped_count,
        'results': results
    }, message="Batch WhatsApp processed")


@sites_bp.route('/<uuid:site_id>/access-link/<uuid:request_id>/revoke', methods=['POST'])
@token_required
def revoke_access_link(site_id, request_id):
    site = repo.get_by_id(site_id)
    if not site or site.business_id != g.business_id:
        return api_response(status_code=404, message="Site not found", error="Not Found")

    access_request = access_repo.get_by_id(request_id)
    if not access_request or access_request.business_id != g.business_id or str(access_request.site_id) != str(site_id):
        return api_response(status_code=404, message="Access link not found", error="Not Found")

    access_repo.revoke(request_id)
    return api_response(message="Access link revoked")
