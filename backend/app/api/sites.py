from flask import Blueprint, request, g, send_file
import os
import uuid
import traceback
import logging
import re
import time
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
from openpyxl.styles import PatternFill
from openpyxl.comments import Comment
from sqlalchemy import and_, or_, func, case
from sqlalchemy.orm import joinedload
from twilio.rest import Client
from ..repositories.site_repository import SiteRepository
from ..repositories.employee_repository import EmployeeRepository
from ..repositories.upload_access_request_repository import UploadAccessRequestRepository
from ..repositories.business_repository import BusinessRepository
from ..repositories.contractor_repository import ContractorRepository
from ..repositories.user_repository import UserRepository
from ..services.sites.hours_matrix_service import (
    build_employee_upload_status_map,
    get_latest_work_card_with_extraction_by_employee,
)
from ..services.sites.report_export import (  # noqa: F401 - re-exported for callers/tests
    LONG_DAY_FILL,
    LONG_DAY_HOURS_THRESHOLD,
    OTHER_SITE_FILL,
    OTHER_SITE_LABEL,
    OTHER_SITE_NAMED_PREFIX,
    STATUS_DAY_LABELS,
    _add_tariff_summary,
    build_salary_workbook,
    _build_other_site_labels,
    other_site_labels_for_site,
    _copy_salary_column_template,
    _copy_salary_row_template,
    _day_fallback_value,
    _ensure_salary_template_month_columns,
    _extract_salary_day_columns_map,
    _find_salary_instruction_row,
    _format_day_label,
    _generate_summary_xlsx,
    _is_long_day,
    _other_site_named_label,
    _populate_salary_template_sheet,
    _populate_template_core_sheet,
    _resolve_salary_template_path,
    _resolve_summary_template_path,
    _safe_label,
    _safe_sheet_name,
    _sort_employees_for_export,
    load_hours_matrix_for_sites,
    populate_salary_batch_workbook,
    populate_summary_batch_workbook,
)
from ..services.sites.report_adjustments_service import load_report_site_data
from ..services.sites.report_model import REPORT_SALARY, REPORT_SUMMARY
from .utils import api_response, model_to_dict, models_to_list
from .dashboard import invalidate_business_cache
from ..auth_utils import token_required, role_required
from ..utils import normalize_phone
from ..models.work_cards import WorkCard, WorkCardExtraction, WorkCardDayEntry
from ..models.sites import Employee, Site
from ..extensions import db
from ..observability import QueryCounter, sites_metrics
from ..services.email_service import send_email_with_attachment
from ..services.whatsapp_listener_client import (
    WhatsAppAuthError,
    WhatsAppBadRequestError,
    WhatsAppListenerClient,
    WhatsAppListenerError,
    WhatsAppNotConnectedError,
    WhatsAppNumberNotRegisteredError,
    WhatsAppPayloadTooLargeError,
)

logger = logging.getLogger(__name__)

sites_bp = Blueprint('sites', __name__, url_prefix='/api/sites')
repo = SiteRepository()
employee_repo = EmployeeRepository()
access_repo = UploadAccessRequestRepository()
business_repo = BusinessRepository()
contractor_repo = ContractorRepository()
user_repo = UserRepository()

STATUS_LABELS = {
    'APPROVED': 'מאושר',
    'NEEDS_REVIEW': 'ממתין לסקירה',
    'NEEDS_ASSIGNMENT': 'ממתין לשיוך',
    'REJECTED': 'נדחה',
    'NO_UPLOAD': 'ללא העלאה',
}


def _site_to_dict_with_contractor(site):
    """Serialize a site with its assigned contractor's display name."""
    site_dict = model_to_dict(site)
    contractor = site.contractor
    site_dict['contractor_name'] = (
        contractor.name
        if contractor and contractor.business_id == site.business_id
        else None
    )
    return site_dict

EMAIL_REGEX = re.compile(r'^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$')

IL_COUNTRY_CODE = '972'


def _normalize_contractor_phone(raw):
    """Normalize a contractor phone input to E.164 digits (no leading +).

    Accepts user input like '050-123-4567', '+972 50 123 4567', '0501234567'.
    Assumes Israel (+972) when input is a local number starting with '0'.
    Returns (digits_only, error_msg). If raw is None/empty, returns (None, None).
    """
    if raw is None:
        return None, None
    if not isinstance(raw, str):
        return None, 'contractor_phone_number must be a string'

    trimmed = raw.strip()
    if not trimmed:
        return None, None

    has_plus = trimmed.startswith('+')
    has_double_zero = trimmed.startswith('00')
    digits = re.sub(r'\D', '', trimmed)
    if not digits:
        return None, f'Invalid phone number: {raw}'

    if has_plus:
        pass
    elif has_double_zero:
        digits = digits[2:]
    elif digits.startswith('0'):
        digits = IL_COUNTRY_CODE + digits[1:]

    if not (8 <= len(digits) <= 15):
        return None, f'Invalid phone number: {raw}'

    return digits, None


def _validate_contractor_emails(data):
    """Validate and normalize contractor_emails field. Returns (cleaned_list, error_msg)."""
    raw = data.get('contractor_emails')
    if raw is None:
        return None, None
    if not isinstance(raw, list):
        return None, 'contractor_emails must be a list'
    cleaned = []
    for item in raw:
        if not isinstance(item, str):
            return None, 'Each contractor email must be a string'
        email = item.strip().lower()
        if not email:
            continue
        if not EMAIL_REGEX.match(email):
            return None, f'Invalid email address: {item}'
        cleaned.append(email)
    return cleaned, None

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

def _load_hours_matrix(site_id, processing_month, approved_only, include_inactive, report_type=None):
    """Load one site's hours matrix. With ``report_type`` the result is the
    report as saved (source data plus report adjustments and notes); without
    it, plain source data."""
    site_data, month = _load_site_data(site_id, processing_month, approved_only, include_inactive, report_type)
    return (
        site_data['employees'], site_data['matrix'], site_data['status_map'], month,
        site_data['status_matrix'], site_data['monthly_totals'], site_data['comment_matrix'],
        site_data['other_site_days'],
    )


def _load_site_data(site_id, processing_month, approved_only, include_inactive, report_type=None):
    """Same as ``_load_hours_matrix`` but returns the whole per-site dict (which
    also carries ``other_site_ids``) and the parsed month."""
    month = datetime.strptime(processing_month, '%Y-%m-%d').date()
    if report_type is not None:
        site_results = load_report_site_data(
            [site_id], processing_month, approved_only, include_inactive, g.business_id, report_type,
        )
    else:
        site_results = load_hours_matrix_for_sites(
            site_ids=[site_id],
            processing_month=processing_month,
            approved_only=approved_only,
            include_inactive=include_inactive,
            business_id=g.business_id,
        )
    site_data = site_results.get(site_id, {'employees': [], 'matrix': {}, 'status_map': {}, 'status_matrix': {}, 'monthly_totals': {}, 'comment_matrix': {}, 'other_site_days': {}, 'other_site_ids': {}})
    return site_data, month


@sites_bp.route('', methods=['GET'])
@token_required
def get_sites():
    """Get all sites, optionally with employee counts, scoped to tenant."""
    try:
        include_counts = request.args.get('include_counts', 'false').lower() == 'true'
        only_active = request.args.get('active', 'false').lower() == 'true'
        
        # Always scope to current business
        business_id = g.business_id
        
        # Resolve assigned field-manager names so the sites table can show them
        # without an extra round-trip per row.
        managers_by_id = {str(u.id): u.full_name for u in user_repo.get_all_for_business(business_id)}
        contractors_by_id = contractor_repo.get_name_map_for_business(business_id)

        def _with_field_manager_name(site_dict):
            fm_id = site_dict.get('field_manager_id')
            site_dict['field_manager_name'] = managers_by_id.get(str(fm_id)) if fm_id else None
            rm_id = site_dict.get('report_manager_id')
            site_dict['report_manager_name'] = managers_by_id.get(str(rm_id)) if rm_id else None
            contractor_id = site_dict.get('contractor_id')
            site_dict['contractor_name'] = contractors_by_id.get(contractor_id) if contractor_id else None
            return site_dict

        if include_counts:
            if only_active:
                results = repo.get_active_with_employee_count(business_id)
            else:
                results = repo.get_with_employee_count(business_id)

            data = []
            for item in results:
                site_dict = model_to_dict(item['site'])
                site_dict['employee_count'] = item['employee_count']
                data.append(_with_field_manager_name(site_dict))
        else:
            if only_active:
                sites = repo.get_active_sites(business_id)
            else:
                sites = repo.get_all(filters={'business_id': business_id})
            data = [_with_field_manager_name(d) for d in models_to_list(sites)]

        return api_response(data=data)
    except Exception as e:
        logger.exception("Failed to get sites")
        traceback.print_exc()
        return api_response(status_code=500, message="Failed to get sites", error=str(e))

def _coerce_expected_cards(data):
    """Validate/normalize expected_work_cards_per_month in-place. Returns error msg or None."""
    if 'expected_work_cards_per_month' not in data:
        return None
    val = data.get('expected_work_cards_per_month')
    if val in (None, ''):
        data['expected_work_cards_per_month'] = None
        return None
    try:
        ival = int(val)
    except (TypeError, ValueError):
        return "מספר כרטיסים צפוי חייב להיות מספר שלם"
    if not (1 <= ival <= 10):
        return "מספר כרטיסים צפוי חייב להיות בין 1 ל-10"
    data['expected_work_cards_per_month'] = ival
    return None


@sites_bp.route('', methods=['POST'])
@token_required
@role_required('ADMIN')
def create_site():
    """Create a new site, scoped to tenant."""
    data = request.get_json()
    if not data:
        return api_response(status_code=400, message="No data provided", error="Bad Request")
    if 'contractor_id' in data:
        return api_response(
            status_code=400,
            message="Contractor assignments must be managed through the contractors API",
            error="Bad Request",
        )
        
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

        if 'contractor_emails' in data:
            emails, err = _validate_contractor_emails(data)
            if err:
                return api_response(status_code=400, message=err, error="Bad Request")
            data['contractor_emails'] = emails

        if 'contractor_phone_number' in data:
            phone, err = _normalize_contractor_phone(data.get('contractor_phone_number'))
            if err:
                return api_response(status_code=400, message=err, error="Bad Request")
            data['contractor_phone_number'] = phone

        err = _coerce_expected_cards(data)
        if err:
            return api_response(status_code=400, message=err, error="Bad Request")

        site = repo.create(**data)
        invalidate_business_cache(g.business_id)
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
            
        return api_response(data=_site_to_dict_with_contractor(site))
    except Exception as e:
        logger.exception(f"Failed to get site {site_id}")
        traceback.print_exc()
        return api_response(status_code=500, message="Failed to get site", error=str(e))

@sites_bp.route('/<uuid:site_id>', methods=['PUT'])
@token_required
@role_required('ADMIN')
def update_site(site_id):
    """Update a site, scoped to tenant."""
    data = request.get_json()
    if not data:
        return api_response(status_code=400, message="No data provided", error="Bad Request")
    if 'contractor_id' in data:
        return api_response(
            status_code=400,
            message="Contractor assignments must be managed through the contractors API",
            error="Bad Request",
        )
        
    try:
        # Verify site belongs to user's business
        site = repo.get_by_id(site_id)
        if not site or site.business_id != g.business_id:
            return api_response(status_code=404, message="Site not found", error="Not Found")
        
        # Don't allow changing business_id
        data.pop('business_id', None)

        if 'contractor_emails' in data:
            emails, err = _validate_contractor_emails(data)
            if err:
                return api_response(status_code=400, message=err, error="Bad Request")
            data['contractor_emails'] = emails

        if 'contractor_phone_number' in data:
            phone, err = _normalize_contractor_phone(data.get('contractor_phone_number'))
            if err:
                return api_response(status_code=400, message=err, error="Bad Request")
            data['contractor_phone_number'] = phone

        if 'hourly_tariff' in data:
            val = data.get('hourly_tariff')
            if val is not None and float(val) < 0:
                return api_response(status_code=400, message="תעריף לשעה חייב להיות חיובי", error="Bad Request")

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

        if 'field_manager_id' in data:
            field_manager_id = data.get('field_manager_id')
            if not field_manager_id:
                data['field_manager_id'] = None
            else:
                try:
                    field_manager_uuid = uuid.UUID(str(field_manager_id))
                except ValueError:
                    return api_response(status_code=400, message="Invalid field_manager_id format", error="Bad Request")

                manager = user_repo.get_by_id(field_manager_uuid)
                if not manager or manager.business_id != g.business_id or manager.role != 'FIELD_MANAGER':
                    return api_response(status_code=404, message="Field manager not found for this business", error="Not Found")

                data['field_manager_id'] = field_manager_uuid

        # Report-only routing for sites with no field manager: the missing-cards
        # report attributes their employees to this manager. Same validation as a
        # real assignment, but it grants no scope anywhere else in the app.
        if 'report_manager_id' in data:
            report_manager_id = data.get('report_manager_id')
            if not report_manager_id:
                data['report_manager_id'] = None
            else:
                try:
                    report_manager_uuid = uuid.UUID(str(report_manager_id))
                except ValueError:
                    return api_response(status_code=400, message="Invalid report_manager_id format", error="Bad Request")

                manager = user_repo.get_by_id(report_manager_uuid)
                if not manager or manager.business_id != g.business_id or manager.role != 'FIELD_MANAGER':
                    return api_response(status_code=404, message="Field manager not found for this business", error="Not Found")

                data['report_manager_id'] = report_manager_uuid

        err = _coerce_expected_cards(data)
        if err:
            return api_response(status_code=400, message=err, error="Bad Request")

        updated_site = repo.update(site_id, **data)
        if not updated_site:
            return api_response(status_code=404, message="Site not found", error="Not Found")

        invalidate_business_cache(g.business_id)
        return api_response(data=_site_to_dict_with_contractor(updated_site), message="Site updated successfully")
    except Exception as e:
        logger.exception(f"Failed to update site {site_id}")
        traceback.print_exc()
        return api_response(status_code=500, message="Failed to update site", error=str(e))

@sites_bp.route('/<uuid:site_id>', methods=['DELETE'])
@token_required
@role_required('ADMIN')
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

        invalidate_business_cache(g.business_id)
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
    started_at = time.perf_counter()
    with QueryCounter(db.engine) as query_counter:
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
            employees, matrix, status_map, _, status_matrix, monthly_totals, _, other_site_days = _load_hours_matrix(
                site_id,
                processing_month,
                approved_only,
                include_inactive
            )

            response = api_response(data={
                'employees': models_to_list(employees),
                'matrix': matrix,
                'status_map': status_map,
                'status_matrix': status_matrix,
                'monthly_totals': monthly_totals,
                'other_site_days': other_site_days,
            })
            return response
        except ValueError as e:
            return api_response(status_code=400, message="Invalid date format. Use YYYY-MM-DD", error=str(e))
        except Exception as e:
            logger.exception(f"Failed to get hours matrix for site {site_id}")
            traceback.print_exc()
            return api_response(status_code=500, message="Failed to get hours matrix", error=str(e))
        finally:
            duration_ms = round((time.perf_counter() - started_at) * 1000, 2)
            logger.info(
                "sites.matrix_route",
                extra={
                    'duration_ms': duration_ms,
                    'site_count': 1,
                    'employee_count': len(employees) if 'employees' in locals() else 0,
                    'query_count': query_counter.count,
                    'output_type': 'json',
                }
            )

@sites_bp.route('/<uuid:site_id>/summary/export', methods=['GET'])
@token_required
@role_required('ADMIN')
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
    # Off by default: the file names the other site only when asked to.
    show_other_site_names = request.args.get('show_other_site_names', 'false').lower() == 'true'

    try:
        site_data, month = _load_site_data(
            site_id,
            processing_month,
            approved_only,
            include_inactive,
            report_type=REPORT_SUMMARY,
        )
        employees, matrix, status_matrix = site_data['employees'], site_data['matrix'], site_data['status_matrix']
        monthly_totals, comment_matrix = site_data['monthly_totals'], site_data['comment_matrix']
        other_site_days = site_data['other_site_days']
        other_site_labels = (
            other_site_labels_for_site(site_id, site_data, g.business_id)
            if show_other_site_names and any(other_site_days.values()) else None
        )
    except ValueError as e:
        return api_response(status_code=400, message="Invalid date format. Use YYYY-MM-DD", error=str(e))
    except Exception as e:
        logger.exception(f"Failed to export hours matrix for site {site_id}")
        traceback.print_exc()
        return api_response(status_code=500, message="Failed to export summary", error=str(e))

    try:
        output, download_name = _generate_summary_xlsx(
            site, employees, matrix, month, status_matrix, monthly_totals, comment_matrix, other_site_days,
            other_site_labels,
        )
    except Exception as e:
        logger.exception(f"Failed to generate summary XLSX for site {site_id}")
        return api_response(status_code=500, message="Failed to generate summary", error=str(e))

    return send_file(
        output,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        as_attachment=True,
        download_name=download_name
    )

@sites_bp.route('/<uuid:site_id>/summary/email', methods=['POST'])
@token_required
@role_required('ADMIN')
def send_summary_email(site_id):
    """Send the monthly summary XLSX as an email attachment to the site's contractor emails."""
    site = repo.get_by_id(site_id)
    if not site or site.business_id != g.business_id:
        return api_response(status_code=404, message="Site not found", error="Not Found")

    recipients = site.contractor_emails or []
    if not recipients:
        return api_response(
            status_code=400,
            message="לא הוגדרו כתובות מייל לאתר זה",
            error="No email recipients configured",
        )

    data = request.get_json() or {}
    processing_month = data.get('processing_month')
    if not processing_month:
        return api_response(status_code=400, message="processing_month is required", error="Bad Request")

    try:
        employees, matrix, _, month, status_matrix, monthly_totals, comment_matrix, other_site_days = _load_hours_matrix(
            site_id, processing_month, approved_only=False, include_inactive=False,
            report_type=REPORT_SUMMARY,
        )
    except ValueError as e:
        return api_response(status_code=400, message="Invalid date format. Use YYYY-MM-DD", error=str(e))
    except Exception as e:
        logger.exception(f"Failed to load hours matrix for email send, site {site_id}")
        return api_response(status_code=500, message="Failed to generate summary", error=str(e))

    try:
        output, filename = _generate_summary_xlsx(site, employees, matrix, month, status_matrix, monthly_totals, comment_matrix, other_site_days)
    except Exception as e:
        logger.exception(f"Failed to generate summary XLSX for email, site {site_id}")
        return api_response(status_code=500, message="Failed to generate summary", error=str(e))

    month_label = month.strftime('%Y-%m')
    subject = f"סיכום חודשי - {site.site_name} - {month_label}"
    html_body = f"""
    <div dir="rtl" style="font-family: Arial, sans-serif;">
        <p>שלום,</p>
        <p>מצורף סיכום שעות חודשי עבור אתר <strong>{site.site_name}</strong> לחודש <strong>{month_label}</strong>.</p>
        <br>
        <p>בברכה,<br>AutoHQ</p>
    </div>
    """

    try:
        result = send_email_with_attachment(
            to=recipients,
            subject=subject,
            html_body=html_body,
            attachment_bytes=output.read(),
            attachment_filename=filename,
        )
    except ValueError as e:
        logger.error(f"Email config error: {e}")
        return api_response(status_code=500, message="Email service not configured", error=str(e))
    except Exception as e:
        logger.exception(f"Failed to send summary email for site {site_id}")
        return api_response(status_code=500, message="שגיאה בשליחת המייל", error=str(e))

    return api_response(
        data={
            "status": "sent",
            "recipients": recipients,
            "site_name": site.site_name,
        },
        message=f"הסיכום נשלח בהצלחה ל-{len(recipients)} נמענים",
    )


@sites_bp.route('/<uuid:site_id>/summary/whatsapp', methods=['POST'])
@token_required
@role_required('ADMIN')
def send_summary_whatsapp(site_id):
    """Send the monthly summary XLSX as a WhatsApp document to the site's contractor phone number."""
    site = repo.get_by_id(site_id)
    if not site or site.business_id != g.business_id:
        return api_response(status_code=404, message="Site not found", error="Not Found")

    phone = site.contractor_phone_number
    if not phone:
        return api_response(
            status_code=400,
            message="לא הוגדר מספר טלפון לאתר זה",
            error="No contractor phone number configured",
        )

    data = request.get_json() or {}
    processing_month = data.get('processing_month')
    if not processing_month:
        return api_response(status_code=400, message="processing_month is required", error="Bad Request")

    client = WhatsAppListenerClient.from_env()
    if client is None:
        return api_response(
            status_code=503,
            message="שירות הוואטסאפ לא מוגדר",
            error="WA_LISTENER_URL is not set",
        )

    try:
        employees, matrix, _, month, status_matrix, monthly_totals, comment_matrix, other_site_days = _load_hours_matrix(
            site_id, processing_month, approved_only=False, include_inactive=False,
            report_type=REPORT_SUMMARY,
        )
    except ValueError as e:
        return api_response(status_code=400, message="Invalid date format. Use YYYY-MM-DD", error=str(e))
    except Exception as e:
        logger.exception(f"Failed to load hours matrix for WhatsApp send, site {site_id}")
        return api_response(status_code=500, message="Failed to generate summary", error=str(e))

    try:
        output, _ = _generate_summary_xlsx(site, employees, matrix, month, status_matrix, monthly_totals, comment_matrix, other_site_days)
    except Exception as e:
        logger.exception(f"Failed to generate summary XLSX for WhatsApp, site {site_id}")
        return api_response(status_code=500, message="Failed to generate summary", error=str(e))

    month_label = month.strftime('%Y-%m')
    business = business_repo.get_by_id(site.business_id)
    business_name = business.name if business else ''
    filename = f"סיכום חודשי - {site.site_name} - {month_label}.xlsx"
    caption = (
        f"שלום,\n"
        f"מצורף דוח סיכום שעות חודשי לאתר {site.site_name} עבור חודש {month_label}.\n"
        f"בברכה,\n"
        f"{business_name}"
    )
    chat_id = f"{phone}@s.whatsapp.net"

    try:
        client.send_document(
            chat_id=chat_id,
            file_bytes=output.read(),
            filename=filename,
            caption=caption,
            mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
    except WhatsAppNumberNotRegisteredError:
        return api_response(
            status_code=404,
            message="המספר אינו רשום בוואטסאפ",
            error="Phone number is not registered on WhatsApp",
        )
    except WhatsAppNotConnectedError:
        return api_response(
            status_code=503,
            message="שירות הוואטסאפ אינו מחובר כרגע",
            error="WhatsApp listener not connected",
        )
    except WhatsAppPayloadTooLargeError:
        return api_response(
            status_code=413,
            message="הקובץ גדול מדי לשליחה בוואטסאפ",
            error="XLSX file exceeds WhatsApp size limit",
        )
    except WhatsAppAuthError as e:
        logger.error(f"WhatsApp listener auth error: {e}")
        return api_response(status_code=500, message="שגיאת הזדהות מול שירות הוואטסאפ", error=str(e))
    except WhatsAppListenerError as e:
        logger.exception(f"WhatsApp listener error sending summary for site {site_id}")
        return api_response(status_code=502, message="שגיאה בשליחת הוואטסאפ", error=str(e))

    return api_response(
        data={
            "status": "sent",
            "phone": phone,
            "site_name": site.site_name,
        },
        message="הסיכום נשלח בוואטסאפ בהצלחה",
    )


@sites_bp.route('/summary/export-batch', methods=['GET'])
@token_required
@role_required('ADMIN')
def export_monthly_summary_batch():
    """Export monthly summary matrices in template format (one sheet per site)."""
    processing_month = request.args.get('processing_month')
    if not processing_month:
        return api_response(status_code=400, message="processing_month is required", error="Bad Request")

    approved_only = request.args.get('approved_only', 'false').lower() == 'true'
    include_inactive = request.args.get('include_inactive', 'false').lower() == 'true'
    include_inactive_sites = request.args.get('include_inactive_sites', 'false').lower() == 'true'
    # Off by default: reports go to contractors, so other sites stay anonymous
    # unless the exporter explicitly asks to name them.
    show_other_site_names = request.args.get('show_other_site_names', 'false').lower() == 'true'
    site_ids_param = request.args.get('site_ids')

    selected_site_ids = None
    if site_ids_param is not None:
        raw_site_ids = [value.strip() for value in site_ids_param.split(',') if value.strip()]
        if not raw_site_ids:
            return api_response(status_code=400, message="site_ids must contain at least one site", error="Bad Request")
        try:
            selected_site_ids = list(dict.fromkeys(uuid.UUID(value) for value in raw_site_ids))
        except ValueError as e:
            return api_response(status_code=400, message="Invalid site_ids format", error=str(e))

    try:
        month = datetime.strptime(processing_month, '%Y-%m-%d').date()
    except ValueError as e:
        return api_response(status_code=400, message="Invalid date format. Use YYYY-MM-DD", error=str(e))

    started_at = time.perf_counter()
    total_employee_count = 0
    with QueryCounter(db.engine) as query_counter:
        if selected_site_ids is None:
            sites = repo.get_all_for_business(g.business_id)
        else:
            sites = repo.get_by_ids_for_business(selected_site_ids, g.business_id)
            if len(sites) != len(selected_site_ids):
                return api_response(
                    status_code=400,
                    message="One or more selected sites are invalid",
                    error="Bad Request",
                )
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

        site_matrices = load_report_site_data(
            site_ids=[site.id for site in sites],
            processing_month=processing_month,
            approved_only=approved_only,
            include_inactive=include_inactive,
            business_id=g.business_id,
            report_type=REPORT_SUMMARY,
        )
        other_site_labels = (
            _build_other_site_labels(site_matrices, g.business_id) if show_other_site_names else {}
        )
        total_employee_count = populate_summary_batch_workbook(
            workbook, sites, site_matrices, month, other_site_labels
        )

        output = BytesIO()
        workbook.save(output)
        output.seek(0)

    duration_s = time.perf_counter() - started_at
    sites_metrics.observe_export_generation_latency(duration_s, output_type='xlsx', endpoint='summary_export_batch')
    logger.info(
        "sites.export_batch_route",
        extra={
            'duration_ms': round(duration_s * 1000, 2),
            'site_count': len(sites),
            'employee_count': total_employee_count,
            'query_count': query_counter.count,
            'output_type': 'xlsx',
        }
    )

    scope = 'selected_sites' if selected_site_ids is not None else 'all_sites'
    download_name = f"monthly_summary_{scope}_{month.strftime('%Y-%m')}.xlsx"
    return send_file(
        output,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        as_attachment=True,
        download_name=download_name
    )

@sites_bp.route('/<uuid:site_id>/salary-template/export', methods=['GET'])
@token_required
@role_required('ADMIN')
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
        employees, matrix, _, _, status_matrix, __, comment_matrix, ___ = _load_hours_matrix(
            site_id,
            processing_month,
            approved_only=False,
            include_inactive=include_inactive,
            report_type=REPORT_SALARY,
        )

        workbook = build_salary_workbook(site, employees, matrix, month, status_matrix, comment_matrix)
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
@role_required('ADMIN')
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

    started_at = time.perf_counter()
    total_employee_count = 0
    with QueryCounter(db.engine) as query_counter:
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

        site_matrices = load_report_site_data(
            site_ids=[site.id for site in sites],
            processing_month=processing_month,
            approved_only=False,
            include_inactive=include_inactive,
            business_id=g.business_id,
            report_type=REPORT_SALARY,
        )

        try:
            total_employee_count = populate_salary_batch_workbook(workbook, sites, site_matrices, month)
        except ValueError as e:
            logger.exception("Invalid salary template format in batch export")
            return api_response(status_code=500, message="Invalid salary template format", error=str(e))

        output = BytesIO()
        workbook.save(output)
        output.seek(0)

    duration_s = time.perf_counter() - started_at
    sites_metrics.observe_export_generation_latency(duration_s, output_type='xlsx', endpoint='salary_export_batch')
    logger.info(
        "sites.salary_export_batch_route",
        extra={
            'duration_ms': round(duration_s * 1000, 2),
            'site_count': len(sites),
            'employee_count': total_employee_count,
            'query_count': query_counter.count,
            'output_type': 'xlsx',
        }
    )

    download_name = f"salary_template_all_sites_{month.strftime('%Y-%m')}.xlsx"
    return send_file(
        output,
        mimetype='application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        as_attachment=True,
        download_name=download_name
    )


@sites_bp.route('/<uuid:site_id>/access-link', methods=['POST'])
@token_required
@role_required('ADMIN', 'OPERATOR_MANAGER')
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
@role_required('ADMIN', 'OPERATOR_MANAGER')
def list_access_links(site_id):
    site = repo.get_by_id(site_id)
    if not site or site.business_id != g.business_id:
        return api_response(status_code=404, message="Site not found", error="Not Found")

    links_with_employees = access_repo.list_active_for_site_with_employee(site_id, g.business_id)
    data = []
    for link, employee_name in links_with_employees:
        link_dict = model_to_dict(link)
        link_dict['employee_name'] = employee_name or ''
        link_dict['url'] = f"{request.host_url.rstrip('/')}/portal/{link.token}"
        data.append(link_dict)

    return api_response(data=data)


@sites_bp.route('/<uuid:site_id>/access-link/<uuid:request_id>/whatsapp', methods=['POST'])
@token_required
@role_required('ADMIN', 'OPERATOR_MANAGER')
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
@role_required('ADMIN')
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

    parsed_site_ids = []
    for site_id in site_ids:
        site_id_str = str(site_id)
        try:
            parsed_site_ids.append((site_id_str, uuid.UUID(site_id_str)))
        except ValueError:
            skipped_count += 1
            sites_metrics.increment_whatsapp_batch_outcome('skipped')
            results.append({
                'site_id': site_id_str,
                'status': 'skipped',
                'reason': 'Invalid site_id format'
            })

    site_lookup = {
        str(site.id): site
        for site in repo.get_by_ids_for_business(
            [parsed_id for _, parsed_id in parsed_site_ids],
            g.business_id,
        )
    }
    responsible_employee_ids = [
        site.responsible_employee_id
        for site in site_lookup.values()
        if site.responsible_employee_id
    ]
    employee_lookup = {
        str(employee.id): employee
        for employee in employee_repo.get_by_ids_for_business(responsible_employee_ids, g.business_id)
    }

    for site_id_str, site_uuid in parsed_site_ids:
        site = site_lookup.get(str(site_uuid))
        if not site:
            skipped_count += 1
            sites_metrics.increment_whatsapp_batch_outcome('skipped')
            results.append({
                'site_id': site_id_str,
                'status': 'skipped',
                'reason': 'Site not found'
            })
            continue

        if not site.responsible_employee_id:
            skipped_count += 1
            sites_metrics.increment_whatsapp_batch_outcome('skipped')
            results.append({
                'site_id': site_id_str,
                'site_name': site.site_name,
                'status': 'skipped',
                'reason': 'No responsible employee'
            })
            continue

        employee = employee_lookup.get(str(site.responsible_employee_id))
        if not employee or employee.business_id != g.business_id or str(employee.site_id) != str(site.id):
            skipped_count += 1
            sites_metrics.increment_whatsapp_batch_outcome('skipped')
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
            sites_metrics.increment_whatsapp_batch_outcome('skipped')
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
            sites_metrics.increment_whatsapp_batch_outcome('skipped')
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
            sites_metrics.increment_whatsapp_batch_outcome('skipped')
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
            sites_metrics.increment_whatsapp_batch_outcome('skipped')
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
            sites_metrics.increment_whatsapp_batch_outcome('failed')
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
            sites_metrics.increment_whatsapp_batch_outcome('sent')
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
            sites_metrics.increment_whatsapp_batch_outcome('failed')
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
@role_required('ADMIN', 'OPERATOR_MANAGER')
def revoke_access_link(site_id, request_id):
    site = repo.get_by_id(site_id)
    if not site or site.business_id != g.business_id:
        return api_response(status_code=404, message="Site not found", error="Not Found")

    access_request = access_repo.get_by_id(request_id)
    if not access_request or access_request.business_id != g.business_id or str(access_request.site_id) != str(site_id):
        return api_response(status_code=404, message="Access link not found", error="Not Found")

    access_repo.revoke(request_id)
    return api_response(message="Access link revoked")
