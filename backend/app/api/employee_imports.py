import logging
import os
import math
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
from flask import Blueprint, request, g

from ..auth_utils import token_required, role_required
from ..repositories.employee_repository import EmployeeRepository
from ..repositories.site_repository import SiteRepository
from ..utils import normalize_phone
from .utils import api_response, model_to_dict
from .dashboard import invalidate_business_cache

logger = logging.getLogger(__name__)

employee_imports_bp = Blueprint('employee_imports', __name__, url_prefix='/api/employee-imports')

employee_repo = EmployeeRepository()
site_repo = SiteRepository()

# File logging for import debugging (writes to backend/logs/employee_imports.log)
LOG_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'logs', 'employee_imports.log')
os.makedirs(os.path.dirname(LOG_PATH), exist_ok=True)
if not any(isinstance(h, logging.FileHandler) and getattr(h, 'baseFilename', '') == LOG_PATH for h in logger.handlers):
    file_handler = logging.FileHandler(LOG_PATH, encoding='utf-8')
    file_handler.setLevel(logging.INFO)
    formatter = logging.Formatter('%(asctime)s %(levelname)s %(message)s')
    file_handler.setFormatter(formatter)
    logger.addHandler(file_handler)
logger.setLevel(logging.INFO)

STATUS_MAP = {
    'פעיל': 'ACTIVE',
    'דווח בהברקה': 'REPORTED_IN_SPARK',
    'דווח כחזר מבריחה': 'REPORTED_RETURNED_FROM_ESCAPE',
}
NEW_SITE_PREFIX = 'new:'
# Report rows with no site are assigned to this dedicated site (created on demand) and kept active.
WITHOUT_SITE_NAME = 'ללא אתר'

PASSPORT_COLUMNS = ['מספר דרכון', 'passport', 'passport_id', 'Passport', 'Passport ID']
FIRST_NAME_COLUMNS = ['שם פרטי', 'first_name', 'first name']
LAST_NAME_COLUMNS = ['שם משפחה', 'last_name', 'last name']
FULL_NAME_COLUMNS = ['שם מלא', 'full_name', 'full name']
SITE_COLUMNS = ['שם הפרויקט הנוכחי', 'אתר', 'site', 'site_name', 'project']
STATUS_COLUMNS = ['סטטוס נוכחי בעברית', 'status', 'employee_status']
PHONE_COLUMNS = ['מספר טלפון', 'מספר טלפון ישראלי', 'טלפון', 'phone', 'phone_number', 'מספר פלאפון']
SERIAL_COLUMNS = ['מספר סידורי', 'serial', 'serial_number', 'external_employee_id']


def _normalize_cell(value: Any) -> Optional[str]:
    if value is None:
        return None
    if isinstance(value, float) and math.isnan(value):
        return None
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        if isinstance(value, float) and value.is_integer():
            value = int(value)
        value = str(value)
    else:
        value = str(value)
    value = value.strip()
    return value or None


def _find_column(df: pd.DataFrame, candidates: List[str]) -> Optional[str]:
    for col in candidates:
        if col in df.columns:
            return col
    return None


def _build_full_name(row: pd.Series, full_name_col: Optional[str], first_name_col: Optional[str], last_name_col: Optional[str]) -> Optional[str]:
    if full_name_col:
        full_name = _normalize_cell(row.get(full_name_col))
        if full_name:
            return full_name
    first = _normalize_cell(row.get(first_name_col)) if first_name_col else None
    last = _normalize_cell(row.get(last_name_col)) if last_name_col else None
    if not first and not last:
        return None
    return ' '.join([part for part in [first, last] if part])


def _normalize_employee_phone(raw: Any) -> Tuple[Optional[str], Optional[Dict[str, Any]]]:
    """Normalize a phone to the system's stored format (0XXXXXXXXX) and flag it
    if the result is not a usable Israeli number.

    Returns (normalized_or_none, warning_or_none). An unusable phone yields
    (None, warning) so the broken value is never stored — the rest of the row
    still imports, with the bad phone surfaced for manual correction. This keeps
    stored phones consumable by the WhatsApp/Twilio path, which strips the
    leading 0 and prepends +972 at send time.
    """
    cell = _normalize_cell(raw)
    if not cell:
        return None, None
    normalized = normalize_phone(cell)
    # Usable = leading-0 Israeli number: 9 digits (landline) or 10 (mobile).
    if normalized and normalized.isdigit() and normalized.startswith('0') and len(normalized) in (9, 10):
        return normalized, None
    return None, {'code': 'invalid_phone', 'details': cell}


def _parse_report(file_bytes: bytes) -> Tuple[List[Dict[str, Any]], Dict[str, Any]]:
    df = pd.read_excel(BytesIO(file_bytes), sheet_name=0)

    passport_col = _find_column(df, PASSPORT_COLUMNS)
    if not passport_col:
        raise ValueError('Passport column not found in report')

    full_name_col = _find_column(df, FULL_NAME_COLUMNS)
    first_name_col = _find_column(df, FIRST_NAME_COLUMNS)
    last_name_col = _find_column(df, LAST_NAME_COLUMNS)
    site_col = _find_column(df, SITE_COLUMNS)
    status_col = _find_column(df, STATUS_COLUMNS)
    phone_col = _find_column(df, PHONE_COLUMNS)
    serial_col = _find_column(df, SERIAL_COLUMNS)

    rows_by_passport: Dict[str, Dict[str, Any]] = {}
    error_rows: List[Dict[str, Any]] = []
    duplicate_map: Dict[str, List[int]] = {}

    for idx, row in df.iterrows():
        row_number = idx + 2  # Header is row 1
        passport_id = _normalize_cell(row.get(passport_col))
        if not passport_id:
            error_rows.append({
                'row_number': row_number,
                'passport_id': None,
                'full_name': None,
                'phone_number': None,
                'site_name': _normalize_cell(row.get(site_col)) if site_col else None,
                'status_raw': _normalize_cell(row.get(status_col)) if status_col else None,
                'external_employee_id': _normalize_cell(row.get(serial_col)) if serial_col else None,
                'errors': ['missing_passport'],
                'warnings': [],
            })
            continue

        if passport_id in rows_by_passport:
            duplicate_map.setdefault(passport_id, []).append(rows_by_passport[passport_id]['row_number'])

        rows_by_passport[passport_id] = {
            'row_number': row_number,
            'passport_id': passport_id,
            'full_name': _build_full_name(row, full_name_col, first_name_col, last_name_col),
            'phone_number': _normalize_cell(row.get(phone_col)) if phone_col else None,
            'site_name': _normalize_cell(row.get(site_col)) if site_col else None,
            'status_raw': _normalize_cell(row.get(status_col)) if status_col else None,
            'external_employee_id': _normalize_cell(row.get(serial_col)) if serial_col else None,
            'errors': [],
            'warnings': [],
        }

    for passport_id, rows in duplicate_map.items():
        if passport_id in rows_by_passport:
            rows_by_passport[passport_id]['warnings'].append({
                'code': 'duplicate_passport',
                'details': rows
            })

    deduped_rows = list(rows_by_passport.values())
    deduped_rows.sort(key=lambda r: r['row_number'])
    error_rows.sort(key=lambda r: r['row_number'])

    meta = {
        'columns': {
            'passport': passport_col,
            'full_name': full_name_col,
            'first_name': first_name_col,
            'last_name': last_name_col,
            'site': site_col,
            'status': status_col,
            'phone': phone_col,
            'serial': serial_col
        }
    }
    logger.info("employee_imports.parse_report rows=%s deduped=%s errors=%s", len(df.index), len(deduped_rows), len(error_rows))
    return deduped_rows + error_rows, meta


def _build_diff(
    rows: List[Dict[str, Any]],
    employees_by_passport: Dict[str, Any],
    sites_by_name: Dict[str, Any],
    sites_by_id: Dict[str, Any],
    allow_site_create: bool = False,
    employees_by_id: Optional[Dict[str, Any]] = None
) -> List[Dict[str, Any]]:
    employees_by_id = employees_by_id or {}
    diff_rows = []
    for row in rows:
        passport_id = row.get('passport_id')
        errors = list(row.get('errors', []))
        warnings = list(row.get('warnings', []))

        status_raw = row.get('status_raw')
        status = STATUS_MAP.get(status_raw) if status_raw else None
        if status_raw and not status:
            warnings.append({'code': 'unknown_status', 'details': status_raw})

        site_name = row.get('site_name')
        site = sites_by_name.get(site_name) if site_name else None
        if site_name and not site:
            warnings.append({'code': 'unknown_site', 'details': site_name})
            if allow_site_create:
                warnings.append({'code': 'site_will_be_created', 'details': site_name})

        site_id = str(site.id) if site else None
        if site_name and not site and allow_site_create:
            site_id = f"{NEW_SITE_PREFIX}{site_name}"

        # A row that appears in the report but has no site is assigned to the dedicated
        # "without site" site (created once per business) and stays active — only employees
        # absent from the report entirely are deactivated.
        if not site_id:
            without_site = sites_by_name.get(WITHOUT_SITE_NAME)
            site_id = str(without_site.id) if without_site else f"{NEW_SITE_PREFIX}{WITHOUT_SITE_NAME}"
            site_name = WITHOUT_SITE_NAME

        phone_number, phone_warning = _normalize_employee_phone(row.get('phone_number'))
        if phone_warning:
            warnings.append(phone_warning)
        external_employee_id = row.get('external_employee_id')

        # Every employee present in the report is active (with a site assigned above).
        desired_active = bool(site_id)

        # Resolve the target employee by explicit id first (absent-from-report rows and
        # null-passport employees), then fall back to passport matching.
        row_employee_id = row.get('employee_id')
        existing = employees_by_id.get(str(row_employee_id)) if row_employee_id else None
        if not existing and passport_id:
            existing = employees_by_passport.get(passport_id)

        changes = []
        action = 'no_change'
        current = None

        if existing:
            current_site_name = None
            if existing.site_id:
                current_site = sites_by_id.get(str(existing.site_id))
                current_site_name = current_site.site_name if current_site else None

            current = {
                'full_name': existing.full_name,
                'phone_number': existing.phone_number,
                'site_id': str(existing.site_id) if existing.site_id else None,
                'site_name': current_site_name,
                'status': existing.status,
                'external_employee_id': existing.external_employee_id,
                'is_active': existing.is_active,
            }

            if row.get('full_name') and row['full_name'] != existing.full_name:
                changes.append({'field': 'full_name', 'from': existing.full_name, 'to': row['full_name']})

            if phone_number and phone_number != existing.phone_number:
                changes.append({'field': 'phone_number', 'from': existing.phone_number, 'to': phone_number})

            if external_employee_id and external_employee_id != existing.external_employee_id:
                changes.append({'field': 'external_employee_id', 'from': existing.external_employee_id, 'to': external_employee_id})

            if status and status != existing.status:
                changes.append({'field': 'status', 'from': existing.status, 'to': status})

            if site_id and str(existing.site_id) != site_id:
                changes.append({'field': 'site_id', 'from': str(existing.site_id), 'to': site_id})

            if desired_active != existing.is_active:
                changes.append({'field': 'is_active', 'from': existing.is_active, 'to': desired_active})

            if not changes:
                action = 'no_change'
            elif not desired_active and existing.is_active:
                action = 'deactivate'
            else:
                action = 'update'
        else:
            required_missing = []
            if not row.get('full_name'):
                required_missing.append('full_name')
            # phone_number is optional
            # site_id is optional
            if required_missing:
                errors.append({'code': 'missing_required', 'details': required_missing})
                action = 'error'
            else:
                action = 'create'
                changes = [
                    {'field': 'full_name', 'from': None, 'to': row.get('full_name')},
                    {'field': 'phone_number', 'from': None, 'to': phone_number},
                    {'field': 'site_id', 'from': None, 'to': site_id},
                    {'field': 'is_active', 'from': None, 'to': desired_active},
                ]
                if external_employee_id:
                    changes.append({'field': 'external_employee_id', 'from': None, 'to': external_employee_id})
                if status:
                    changes.append({'field': 'status', 'from': None, 'to': status})

        if errors:
            action = 'error'

        diff_rows.append({
            'row_number': row.get('row_number'),
            'employee_id': str(existing.id) if existing else None,
            'passport_id': passport_id,
            'full_name': row.get('full_name'),
            'phone_number': phone_number,
            'site_name': site_name,
            'site_id': site_id,
            'status_raw': status_raw,
            'status': status,
            'external_employee_id': external_employee_id,
            'is_active': desired_active,
            'action': action,
            'changes': changes,
            'errors': errors,
            'warnings': warnings,
            'current': current
        })
    return diff_rows


def _build_absent_deactivations(
    active_employees: List[Any],
    present_passports: set,
    present_employee_ids: set,
    sites_by_id: Dict[str, Any],
) -> List[Dict[str, Any]]:
    """Synthesize deactivation rows for active employees absent from the report.

    Source-of-truth rule: an active employee who does not appear in the uploaded
    report should be deactivated. Represented as its own diff row so the admin sees
    the full deactivation list in the preview before applying.
    """
    absent_rows = []
    for emp in active_employees:
        emp_id = str(emp.id)
        if emp_id in present_employee_ids:
            continue
        if emp.passport_id and emp.passport_id in present_passports:
            continue

        current_site_name = None
        if emp.site_id:
            current_site = sites_by_id.get(str(emp.site_id))
            current_site_name = current_site.site_name if current_site else None

        absent_rows.append({
            'row_number': None,
            'employee_id': emp_id,
            'passport_id': emp.passport_id,
            'full_name': emp.full_name,
            'phone_number': emp.phone_number,
            'site_name': None,
            'site_id': None,
            'status_raw': None,
            'status': emp.status,
            'external_employee_id': emp.external_employee_id,
            'is_active': False,
            'action': 'deactivate',
            'changes': [{'field': 'is_active', 'from': True, 'to': False}],
            'errors': [],
            'warnings': [{'code': 'absent_from_report'}],
            'current': {
                'full_name': emp.full_name,
                'phone_number': emp.phone_number,
                'site_id': str(emp.site_id) if emp.site_id else None,
                'site_name': current_site_name,
                'status': emp.status,
                'external_employee_id': emp.external_employee_id,
                'is_active': emp.is_active,
            },
        })
    return absent_rows


def _summarize(rows: List[Dict[str, Any]]) -> Dict[str, int]:
    summary = {'create': 0, 'update': 0, 'deactivate': 0, 'no_change': 0, 'error': 0, 'total': len(rows)}
    for row in rows:
        action = row.get('action')
        if action in summary:
            summary[action] += 1
        else:
            summary['error'] += 1
    return summary


@employee_imports_bp.route('/preview', methods=['POST'])
@token_required
@role_required('ADMIN')
def preview_import():
    if 'file' not in request.files:
        return api_response(status_code=400, message="No file provided", error="Bad Request")

    file = request.files['file']
    if not file or file.filename == '':
        return api_response(status_code=400, message="No file selected", error="Bad Request")

    try:
        logger.info("employee_imports.preview start filename=%s business_id=%s", file.filename, g.business_id)
        rows, meta = _parse_report(file.read())
        passports = [r['passport_id'] for r in rows if r.get('passport_id')]
        employees = employee_repo.get_by_passports(passports, business_id=g.business_id)
        employees_by_passport = {e.passport_id: e for e in employees}

        sites = site_repo.get_all_for_business(g.business_id)
        sites_by_name = {s.site_name: s for s in sites}
        sites_by_id = {str(s.id): s for s in sites}

        employees_by_id = {str(e.id): e for e in employees}
        diff_rows = _build_diff(
            rows, employees_by_passport, sites_by_name, sites_by_id,
            allow_site_create=True, employees_by_id=employees_by_id
        )

        # Deactivate active employees absent from the report (report is source of truth).
        present_passports = {r.get('passport_id') for r in rows if r.get('passport_id')}
        present_employee_ids = {r['employee_id'] for r in diff_rows if r.get('employee_id')}
        active_employees = employee_repo.get_active_employees(business_id=g.business_id)
        diff_rows.extend(_build_absent_deactivations(
            active_employees, present_passports, present_employee_ids, sites_by_id
        ))

        summary = _summarize(diff_rows)
        logger.info("employee_imports.preview summary=%s matched=%s sites=%s", summary, len(employees_by_passport), len(sites))

        return api_response(
            data={
                'summary': summary,
                'rows': diff_rows,
                'meta': meta
            }
        )
    except ValueError as e:
        logger.exception("employee_imports.preview validation_error=%s", str(e))
        return api_response(status_code=400, message=str(e), error="Bad Request")
    except Exception as e:
        logger.exception("Failed to preview employee import")
        return api_response(status_code=500, message="Failed to preview employee import", error=str(e))


@employee_imports_bp.route('/apply', methods=['POST'])
@token_required
@role_required('ADMIN')
def apply_import():
    data = request.get_json()
    if not data or 'rows' not in data:
        return api_response(status_code=400, message="rows is required", error="Bad Request")

    rows_input = data.get('rows', [])
    if not isinstance(rows_input, list):
        return api_response(status_code=400, message="rows must be an array", error="Bad Request")

    logger.info("employee_imports.apply start business_id=%s rows=%s", g.business_id, len(rows_input))
    normalized_rows = [
        {
            'row_number': row.get('row_number'),
            'employee_id': _normalize_cell(row.get('employee_id')),
            'passport_id': _normalize_cell(row.get('passport_id')),
            'full_name': _normalize_cell(row.get('full_name')),
            'phone_number': _normalize_cell(row.get('phone_number')),
            'site_name': _normalize_cell(row.get('site_name')),
            'status_raw': _normalize_cell(row.get('status_raw')),
            'external_employee_id': _normalize_cell(row.get('external_employee_id')),
            'action': row.get('action'),
            'errors': [],
            'warnings': []
        }
        for row in rows_input
    ]

    # Split absent-from-report deactivations from ordinary report rows. Under the current
    # rule a report row always gets a site (real or the "without site" site) and stays
    # active, so only synthesized absent rows carry action == 'deactivate'. These must NOT
    # go through _build_diff — its no-site defaulting would re-assign them a site and keep
    # them active. They are deactivated directly below instead.
    deactivate_input = [r for r in normalized_rows if r.get('action') == 'deactivate']
    report_input = [r for r in normalized_rows if r.get('action') != 'deactivate']

    # Deduplicate report rows by passport (keep last); passport-less report rows are errors.
    rows_by_passport = {}
    error_rows = []
    for row in report_input:
        passport = row.get('passport_id')
        if passport:
            rows_by_passport[passport] = row
        else:
            row['errors'] = ['missing_passport']
            error_rows.append(row)
    rows = list(rows_by_passport.values())
    rows.extend(error_rows)

    # Deduplicate absent rows by employee id (falling back to passport).
    deactivate_by_key = {}
    for row in deactivate_input:
        key = row.get('employee_id') or row.get('passport_id')
        if key:
            deactivate_by_key[key] = row
    deactivate_rows = list(deactivate_by_key.values())

    try:
        passports = [r['passport_id'] for r in rows if r.get('passport_id')]
        passports += [r['passport_id'] for r in deactivate_rows if r.get('passport_id')]
        employee_ids = [r['employee_id'] for r in (rows + deactivate_rows) if r.get('employee_id')]
        employees = list(employee_repo.get_by_passports(passports, business_id=g.business_id))
        if employee_ids:
            employees += employee_repo.get_by_ids_for_business(employee_ids, business_id=g.business_id)
        employees_by_passport = {e.passport_id: e for e in employees if e.passport_id}
        employees_by_id = {str(e.id): e for e in employees}

        sites = site_repo.get_all_for_business(g.business_id)
        sites_by_name = {s.site_name: s for s in sites}
        sites_by_id = {str(s.id): s for s in sites}

        diff_rows = _build_diff(
            rows, employees_by_passport, sites_by_name, sites_by_id,
            allow_site_create=True, employees_by_id=employees_by_id
        )

        applied = []
        created_count = 0
        updated_count = 0
        deactivated_count = 0
        created_sites = {}
        for row in diff_rows:
            if row['action'] == 'create':
                site_id = row['site_id']
                if site_id and site_id.startswith(NEW_SITE_PREFIX):
                    site_name = row.get('site_name')
                    if site_name:
                        site = sites_by_name.get(site_name)
                        if not site:
                            site = site_repo.create(
                                business_id=g.business_id,
                                site_name=site_name,
                                is_active=True
                            )
                            sites_by_name[site_name] = site
                            sites_by_id[str(site.id)] = site
                            created_sites[site_name] = str(site.id)
                        site_id = str(site.id)

                employee = employee_repo.create(
                    business_id=g.business_id,
                    site_id=site_id,
                    full_name=row['full_name'],
                    passport_id=row['passport_id'],
                    phone_number=row['phone_number'],
                    status=row['status'],
                    external_employee_id=row['external_employee_id'],
                    is_active=row['is_active']
                )
                applied.append({'action': 'create', 'employee': model_to_dict(employee), 'row_number': row['row_number']})
                created_count += 1
            elif row['action'] == 'update':
                existing = employees_by_id.get(str(row.get('employee_id'))) if row.get('employee_id') else None
                if not existing and row.get('passport_id'):
                    existing = employees_by_passport.get(row['passport_id'])
                if not existing:
                    row['action'] = 'error'
                    row['errors'].append({'code': 'missing_employee', 'details': row.get('passport_id') or row.get('employee_id')})
                    continue

                update_payload = {}
                for change in row['changes']:
                    field = change['field']
                    if field == 'site_id':
                        site_id = row['site_id']
                        if site_id and site_id.startswith(NEW_SITE_PREFIX):
                            site_name = row.get('site_name')
                            if site_name:
                                site = sites_by_name.get(site_name)
                                if not site:
                                    site = site_repo.create(
                                        business_id=g.business_id,
                                        site_name=site_name,
                                        is_active=True
                                    )
                                    sites_by_name[site_name] = site
                                    sites_by_id[str(site.id)] = site
                                    created_sites[site_name] = str(site.id)
                                site_id = str(site.id)
                        if site_id:
                            update_payload['site_id'] = site_id
                    elif field == 'full_name':
                        update_payload['full_name'] = row['full_name']
                    elif field == 'phone_number':
                        update_payload['phone_number'] = row['phone_number']
                    elif field == 'external_employee_id':
                        update_payload['external_employee_id'] = row['external_employee_id']
                    elif field == 'status':
                        update_payload['status'] = row['status']
                    elif field == 'is_active':
                        update_payload['is_active'] = row['is_active']

                if update_payload:
                    updated = employee_repo.update(existing.id, **update_payload)
                    applied.append({'action': 'update', 'employee': model_to_dict(updated), 'row_number': row['row_number']})
                    updated_count += 1
            else:
                continue

        # Deactivate employees absent from the report — directly, bypassing _build_diff's
        # no-site defaulting. The report always wins: skip anyone also present as a report row.
        report_employee_ids = {r['employee_id'] for r in diff_rows if r.get('employee_id')}
        for row in deactivate_rows:
            existing = employees_by_id.get(str(row.get('employee_id'))) if row.get('employee_id') else None
            if not existing and row.get('passport_id'):
                existing = employees_by_passport.get(row['passport_id'])

            if not existing:
                diff_rows.append({
                    'row_number': row.get('row_number'), 'employee_id': row.get('employee_id'),
                    'passport_id': row.get('passport_id'), 'full_name': row.get('full_name'),
                    'phone_number': None, 'site_name': None, 'site_id': None,
                    'status_raw': None, 'status': None, 'external_employee_id': None,
                    'is_active': False, 'action': 'error', 'changes': [],
                    'errors': [{'code': 'missing_employee', 'details': row.get('employee_id') or row.get('passport_id')}],
                    'warnings': [{'code': 'absent_from_report'}], 'current': None,
                })
                continue

            if str(existing.id) in report_employee_ids:
                continue  # also present in the report — stays active

            transitioned = bool(existing.is_active)
            if transitioned:
                updated = employee_repo.update(existing.id, is_active=False)
                applied.append({'action': 'deactivate', 'employee': model_to_dict(updated), 'row_number': row.get('row_number')})
                deactivated_count += 1

            diff_rows.append({
                'row_number': row.get('row_number'), 'employee_id': str(existing.id),
                'passport_id': existing.passport_id, 'full_name': existing.full_name,
                'phone_number': existing.phone_number, 'site_name': None,
                'site_id': str(existing.site_id) if existing.site_id else None,
                'status_raw': None, 'status': existing.status,
                'external_employee_id': existing.external_employee_id, 'is_active': False,
                'action': 'deactivate' if transitioned else 'no_change',
                'changes': [{'field': 'is_active', 'from': True, 'to': False}] if transitioned else [],
                'errors': [], 'warnings': [{'code': 'absent_from_report'}], 'current': None,
            })

        invalidate_business_cache(g.business_id)
        summary = _summarize(diff_rows)
        logger.info(
            "employee_imports.apply summary=%s created=%s updated=%s deactivated=%s created_sites=%s",
            summary, created_count, updated_count, deactivated_count, len(created_sites)
        )
        return api_response(
            data={
                'summary': summary,
                'rows': diff_rows,
                'applied': applied
            },
            message="Employee import applied"
        )
    except Exception as e:
        logger.exception("Failed to apply employee import")
        return api_response(status_code=500, message="Failed to apply employee import", error=str(e))
