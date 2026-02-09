import logging
import os
import math
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
from flask import Blueprint, request, g

from ..auth_utils import token_required
from ..repositories.employee_repository import EmployeeRepository
from ..repositories.site_repository import SiteRepository
from ..utils import normalize_phone
from .utils import api_response, model_to_dict

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

PASSPORT_COLUMNS = ['מספר דרכון', 'passport', 'passport_id', 'Passport', 'Passport ID']
FIRST_NAME_COLUMNS = ['שם פרטי', 'first_name', 'first name']
LAST_NAME_COLUMNS = ['שם משפחה', 'last_name', 'last name']
FULL_NAME_COLUMNS = ['שם מלא', 'full_name', 'full name']
SITE_COLUMNS = ['שם הפרויקט הנוכחי', 'אתר', 'site', 'site_name', 'project']
STATUS_COLUMNS = ['סטטוס נוכחי בעברית', 'status', 'employee_status']
PHONE_COLUMNS = ['מספר טלפון', 'טלפון', 'phone', 'phone_number', 'מספר פלאפון']


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
            'phone': phone_col
        }
    }
    logger.info("employee_imports.parse_report rows=%s deduped=%s errors=%s", len(df.index), len(deduped_rows), len(error_rows))
    return deduped_rows + error_rows, meta


def _build_diff(
    rows: List[Dict[str, Any]],
    employees_by_passport: Dict[str, Any],
    sites_by_name: Dict[str, Any],
    sites_by_id: Dict[str, Any],
    allow_site_create: bool = False
) -> List[Dict[str, Any]]:
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
        phone_number = normalize_phone(row.get('phone_number') or '') if row.get('phone_number') else None

        existing = employees_by_passport.get(passport_id) if passport_id else None
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
                'status': existing.status
            }

            if row.get('full_name') and row['full_name'] != existing.full_name:
                changes.append({'field': 'full_name', 'from': existing.full_name, 'to': row['full_name']})

            if phone_number and phone_number != existing.phone_number:
                changes.append({'field': 'phone_number', 'from': existing.phone_number, 'to': phone_number})

            if status and status != existing.status:
                changes.append({'field': 'status', 'from': existing.status, 'to': status})

            if site_id and str(existing.site_id) != site_id:
                changes.append({'field': 'site_id', 'from': str(existing.site_id), 'to': site_id})

            action = 'update' if changes else 'no_change'
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
                ]
                if status:
                    changes.append({'field': 'status', 'from': None, 'to': status})

        if errors:
            action = 'error'

        diff_rows.append({
            'row_number': row.get('row_number'),
            'passport_id': passport_id,
            'full_name': row.get('full_name'),
            'phone_number': phone_number,
            'site_name': site_name,
            'site_id': site_id,
            'status_raw': status_raw,
            'status': status,
            'action': action,
            'changes': changes,
            'errors': errors,
            'warnings': warnings,
            'current': current
        })
    return diff_rows


def _summarize(rows: List[Dict[str, Any]]) -> Dict[str, int]:
    summary = {'create': 0, 'update': 0, 'no_change': 0, 'error': 0, 'total': len(rows)}
    for row in rows:
        action = row.get('action')
        if action in summary:
            summary[action] += 1
        else:
            summary['error'] += 1
    return summary


@employee_imports_bp.route('/preview', methods=['POST'])
@token_required
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

        diff_rows = _build_diff(rows, employees_by_passport, sites_by_name, sites_by_id, allow_site_create=True)
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
            'passport_id': _normalize_cell(row.get('passport_id')),
            'full_name': _normalize_cell(row.get('full_name')),
            'phone_number': _normalize_cell(row.get('phone_number')),
            'site_name': _normalize_cell(row.get('site_name')),
            'status_raw': _normalize_cell(row.get('status_raw')),
            'errors': [],
            'warnings': []
        }
        for row in rows_input
    ]

    # Deduplicate by passport (keep last)
    rows_by_passport = {}
    error_rows = []
    for row in normalized_rows:
        passport = row.get('passport_id')
        if not passport:
            row['errors'] = ['missing_passport']
            error_rows.append(row)
            continue
        rows_by_passport[passport] = row
    rows = list(rows_by_passport.values())
    rows.extend(error_rows)

    try:
        passports = [r['passport_id'] for r in rows if r.get('passport_id')]
        employees = employee_repo.get_by_passports(passports, business_id=g.business_id)
        employees_by_passport = {e.passport_id: e for e in employees}

        sites = site_repo.get_all_for_business(g.business_id)
        sites_by_name = {s.site_name: s for s in sites}
        sites_by_id = {str(s.id): s for s in sites}

        diff_rows = _build_diff(rows, employees_by_passport, sites_by_name, sites_by_id, allow_site_create=True)

        applied = []
        created_count = 0
        updated_count = 0
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
                    status=row['status']
                )
                applied.append({'action': 'create', 'employee': model_to_dict(employee), 'row_number': row['row_number']})
                created_count += 1
            elif row['action'] == 'update':
                existing = employees_by_passport.get(row['passport_id'])
                if not existing:
                    row['action'] = 'error'
                    row['errors'].append({'code': 'missing_employee', 'details': row['passport_id']})
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
                    elif field == 'status':
                        update_payload['status'] = row['status']

                if update_payload:
                    updated = employee_repo.update(existing.id, **update_payload)
                    applied.append({'action': 'update', 'employee': model_to_dict(updated), 'row_number': row['row_number']})
                    updated_count += 1
            else:
                continue

        summary = _summarize(diff_rows)
        logger.info("employee_imports.apply summary=%s created=%s updated=%s created_sites=%s", summary, created_count, updated_count, len(created_sites))
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
