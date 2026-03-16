import logging
import re
from io import BytesIO
from typing import Any, Dict, List, Optional, Tuple

import pandas as pd
from flask import Blueprint, request, g

from ..auth_utils import token_required, role_required
from ..repositories.site_repository import SiteRepository
from .employee_imports import _normalize_cell
from .utils import api_response

logger = logging.getLogger(__name__)

site_tariff_import_bp = Blueprint('site_tariff_import', __name__, url_prefix='/api/sites/tariff-import')

site_repo = SiteRepository()

SITE_NAME_ALIASES = ['שם האתר', 'שם אתר', 'site_name', 'אתר']
TARIFF_ALIASES = ['מחיר', 'תעריף', 'תעריף שעתי', 'tariff', 'hourly_tariff', 'price']


def _normalize_name(name: str) -> str:
    """Collapse whitespace for fuzzy matching."""
    return re.sub(r'\s+', ' ', name.strip())


def _build_site_lookups(business_id):
    """Fetch all sites and build lookup dicts by exact and normalized name."""
    sites = site_repo.get_all_for_business(business_id)
    by_name: Dict[str, Any] = {}
    by_normalized: Dict[str, Any] = {}
    for s in sites:
        by_name[s.site_name.strip()] = s
        by_normalized[_normalize_name(s.site_name)] = s
    return sites, by_name, by_normalized


def _match_site(site_name: str, by_name: Dict[str, Any], by_normalized: Dict[str, Any]):
    """Match a site name: exact-after-trim first, then normalized whitespace."""
    matched = by_name.get(site_name.strip())
    if not matched:
        matched = by_normalized.get(_normalize_name(site_name))
    return matched


def _validate_tariff(tariff_raw) -> Tuple[Optional[float], List[str]]:
    """Validate and parse a tariff value. Returns (parsed_value, errors)."""
    errors = []
    if tariff_raw is None:
        errors.append('תעריף לא תקין')
        return None, errors
    try:
        value = float(tariff_raw)
        if value < 0:
            errors.append('תעריף חייב להיות חיובי')
            return None, errors
        return value, []
    except (ValueError, TypeError):
        errors.append('תעריף לא תקין')
        return None, errors


def _tariff_changed(current: Optional[float], new: Optional[float]) -> bool:
    """Compare tariffs safely, handling Decimal->float rounding."""
    if current is None and new is None:
        return False
    if current is None or new is None:
        return True
    return round(current, 2) != round(new, 2)


def _summarize(rows: List[Dict[str, Any]]) -> Dict[str, int]:
    """Compute summary counts by action."""
    summary = {'update': 0, 'no_change': 0, 'error': 0, 'total': len(rows)}
    for row in rows:
        action = row.get('action')
        if action in summary:
            summary[action] += 1
        else:
            summary['error'] += 1
    return summary


def _parse_tariff_file(file_bytes: bytes) -> List[Dict[str, Any]]:
    """Parse Excel file, auto-detect header row and columns."""
    try:
        df = pd.read_excel(BytesIO(file_bytes), header=None, sheet_name='תעריפים לכל אתר')
    except (KeyError, ValueError):
        df = pd.read_excel(BytesIO(file_bytes), header=None, sheet_name=0)

    # Scan for header row
    header_row = None
    site_col = None
    tariff_col = None

    for idx, row in df.iterrows():
        row_values = [str(v).strip() if pd.notna(v) else '' for v in row]
        for ci, cell in enumerate(row_values):
            if cell in SITE_NAME_ALIASES:
                site_col_candidate = ci
                for cj, cell2 in enumerate(row_values):
                    if cell2 in TARIFF_ALIASES:
                        header_row = idx
                        site_col = site_col_candidate
                        tariff_col = cj
                        break
                if header_row is not None:
                    break
        if header_row is not None:
            break

    if header_row is None:
        raise ValueError('לא נמצאו כותרות מתאימות בקובץ (שם האתר / מחיר)')

    rows = []
    for idx in range(header_row + 1, len(df)):
        site_name = _normalize_cell(df.iloc[idx, site_col])
        tariff_raw = _normalize_cell(df.iloc[idx, tariff_col])

        if not site_name:
            continue

        rows.append({
            'row_number': idx + 1,  # 1-based for display
            'site_name': site_name,
            'tariff_raw': tariff_raw,
        })

    return rows


def _build_diff_row(site_name: str, row_number: int, new_tariff: Optional[float],
                    tariff_errors: List[str], by_name: Dict, by_normalized: Dict) -> Dict[str, Any]:
    """Build a single diff row with matching and validation."""
    errors = list(tariff_errors)
    warnings: List[str] = []

    matched_site = _match_site(site_name, by_name, by_normalized)

    matched_site_id = None
    matched_site_name = None
    current_tariff = None
    action = 'error'

    if not matched_site:
        errors.append('אתר לא נמצא')
    else:
        matched_site_id = str(matched_site.id)
        matched_site_name = matched_site.site_name
        current_tariff = float(matched_site.hourly_tariff) if matched_site.hourly_tariff is not None else None

        if not errors:
            if not _tariff_changed(current_tariff, new_tariff):
                action = 'no_change'
            else:
                action = 'update'

    if errors:
        action = 'error'

    return {
        'row_number': row_number,
        'site_name_from_file': site_name,
        'matched_site_id': matched_site_id,
        'matched_site_name': matched_site_name,
        'current_tariff': current_tariff,
        'new_tariff': new_tariff,
        'action': action,
        'errors': errors,
        'warnings': warnings,
        '_matched_site': matched_site,  # internal, stripped before response
    }


def _build_tariff_diff(parsed_rows: List[Dict[str, Any]], business_id) -> Tuple[List[Dict[str, Any]], Dict[str, int]]:
    _sites, by_name, by_normalized = _build_site_lookups(business_id)

    seen_names: Dict[str, int] = {}
    diff_rows: List[Dict[str, Any]] = []

    for parsed in parsed_rows:
        site_name = parsed['site_name']
        new_tariff, tariff_errors = _validate_tariff(parsed['tariff_raw'])

        row_entry = _build_diff_row(
            site_name, parsed['row_number'], new_tariff, tariff_errors, by_name, by_normalized
        )

        # Handle duplicates — mark earlier occurrence as error
        norm_key = _normalize_name(site_name)
        if norm_key in seen_names:
            prev_idx = seen_names[norm_key]
            diff_rows[prev_idx]['action'] = 'error'
            diff_rows[prev_idx]['errors'].append('שורה כפולה - נדרש רק רשומה אחת לכל אתר')

        seen_names[norm_key] = len(diff_rows)
        diff_rows.append(row_entry)

    # Strip internal fields before response
    for row in diff_rows:
        row.pop('_matched_site', None)

    return diff_rows, _summarize(diff_rows)


@site_tariff_import_bp.route('/preview', methods=['POST'])
@token_required
@role_required('ADMIN')
def preview_tariff_import():
    if 'file' not in request.files:
        return api_response(status_code=400, message="No file provided", error="Bad Request")

    file = request.files['file']
    if not file or file.filename == '':
        return api_response(status_code=400, message="No file selected", error="Bad Request")

    try:
        parsed_rows = _parse_tariff_file(file.read())
        diff_rows, summary = _build_tariff_diff(parsed_rows, g.business_id)

        return api_response(data={'summary': summary, 'rows': diff_rows})
    except ValueError as e:
        return api_response(status_code=400, message=str(e), error="Bad Request")
    except Exception as e:
        logger.exception("Failed to preview site tariff import")
        return api_response(status_code=500, message="Failed to preview site tariff import", error=str(e))


@site_tariff_import_bp.route('/apply', methods=['POST'])
@token_required
@role_required('ADMIN')
def apply_tariff_import():
    data = request.get_json()
    if not data or 'rows' not in data:
        return api_response(status_code=400, message="rows is required", error="Bad Request")

    rows_input = data['rows']
    if not isinstance(rows_input, list):
        return api_response(status_code=400, message="rows must be an array", error="Bad Request")

    try:
        _sites, by_name, by_normalized = _build_site_lookups(g.business_id)

        applied = []
        diff_rows = []
        seen_names: Dict[str, int] = {}

        for row in rows_input:
            site_name = row.get('site_name_from_file', '')
            row_number = row.get('row_number')

            if not site_name:
                continue

            new_tariff, tariff_errors = _validate_tariff(row.get('new_tariff'))

            row_entry = _build_diff_row(
                site_name, row_number, new_tariff, tariff_errors, by_name, by_normalized
            )

            # Handle duplicates
            norm_key = _normalize_name(site_name)
            if norm_key in seen_names:
                prev_idx = seen_names[norm_key]
                diff_rows[prev_idx]['action'] = 'error'
                diff_rows[prev_idx]['errors'].append('שורה כפולה - נדרש רק רשומה אחת לכל אתר')

            seen_names[norm_key] = len(diff_rows)

            matched_site = row_entry.pop('_matched_site', None)

            if row_entry['action'] == 'update' and matched_site:
                matched_site.hourly_tariff = new_tariff
                applied.append({
                    'site_id': str(matched_site.id),
                    'site_name': matched_site.site_name,
                    'old_tariff': row_entry['current_tariff'],
                    'new_tariff': new_tariff,
                })

            diff_rows.append(row_entry)

        # Single atomic commit for all updates
        site_repo.commit()

        # Strip internal fields and recompute summary after duplicate handling
        for row in diff_rows:
            row.pop('_matched_site', None)

        return api_response(
            data={'summary': _summarize(diff_rows), 'rows': diff_rows, 'applied': applied},
            message="Site tariff import applied"
        )
    except Exception as e:
        site_repo.rollback()
        logger.exception("Failed to apply site tariff import")
        return api_response(status_code=500, message="Failed to apply site tariff import", error=str(e))
