from flask import Blueprint, request, g
from datetime import datetime, timezone
import time
from werkzeug.utils import secure_filename
from ..repositories.upload_access_request_repository import UploadAccessRequestRepository
from ..repositories.employee_repository import EmployeeRepository
from ..repositories.site_repository import SiteRepository
from ..repositories.work_card_repository import WorkCardRepository
from ..repositories.work_card_file_repository import WorkCardFileRepository
from ..repositories.work_card_extraction_repository import WorkCardExtractionRepository
from ..repositories.user_repository import UserRepository
from ..repositories.business_repository import BusinessRepository
from ..utils import normalize_phone, utc_now
from .utils import api_response
from ..auth_utils import encode_portal_token, portal_token_required, admin_portal_token_required

public_portal_bp = Blueprint('public_portal', __name__, url_prefix='/api/public')
access_repo = UploadAccessRequestRepository()
employee_repo = EmployeeRepository()
site_repo = SiteRepository()
work_card_repo = WorkCardRepository()
file_repo = WorkCardFileRepository()
extraction_repo = WorkCardExtractionRepository()
user_repo = UserRepository()
business_repo = BusinessRepository()

VERIFY_RATE_LIMIT = 5
VERIFY_WINDOW_SECONDS = 60
_verify_attempts: dict[str, list[float]] = {}

def _is_rate_limited(ip_address: str) -> bool:
    now = time.time()
    attempts = _verify_attempts.get(ip_address, [])
    attempts = [ts for ts in attempts if now - ts < VERIFY_WINDOW_SECONDS]
    if len(attempts) >= VERIFY_RATE_LIMIT:
        _verify_attempts[ip_address] = attempts
        return True
    attempts.append(now)
    _verify_attempts[ip_address] = attempts
    return False

@public_portal_bp.route('/verify-access', methods=['POST'])
def verify_access():
    payload = request.get_json() or {}
    token = payload.get('token')
    phone_number = payload.get('phone_number')

    if not token or not phone_number:
        return api_response(status_code=400, message="token and phone_number are required", error="Bad Request")

    ip_address = request.headers.get('X-Forwarded-For', request.remote_addr) or 'unknown'
    if _is_rate_limited(ip_address):
        return api_response(status_code=429, message="Too many attempts. Please try again later.", error="Rate Limit")

    access_request = access_repo.get_active_by_token(token)
    if not access_request:
        return api_response(status_code=404, message="Invalid or expired access link", error="Not Found")

    employee = employee_repo.get_by_id(access_request.employee_id)
    if not employee:
        return api_response(status_code=404, message="Employee not found", error="Not Found")

    if normalize_phone(employee.phone_number) != normalize_phone(phone_number):
        return api_response(status_code=401, message="Phone verification failed", error="Unauthorized")

    access_repo.update(access_request.id, last_accessed_at=utc_now())

    portal_payload = {
        'scope': 'RESPONSIBLE_EMPLOYEE_UPLOAD',
        'request_id': str(access_request.id),
        'business_id': str(access_request.business_id),
        'site_id': str(access_request.site_id),
        'processing_month': access_request.processing_month.isoformat(),
        'employee_id': str(access_request.employee_id),
    }
    session_token = encode_portal_token(portal_payload, expires_in_seconds=3600)

    site = site_repo.get_by_id(access_request.site_id)
    response_data = {
        'session_token': session_token,
        'site_name': site.site_name if site else '',
        'employee_name': employee.full_name,
        'month': access_request.processing_month.isoformat(),
    }
    return api_response(data=response_data, message="Verification successful")

@public_portal_bp.route('/upload', methods=['POST'])
@portal_token_required
def upload_files():
    # Define allowed MIME types
    ALLOWED_TYPES = {
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf'
    }

    portal_claims = g.portal_claims
    request_id = portal_claims.get('request_id')

    if request_id:
        access_request = access_repo.get_by_id(request_id)
        if not access_request or not access_request.is_active:
            return api_response(status_code=403, message="Access link revoked", error="Forbidden")
        if access_request.expires_at and access_request.expires_at <= datetime.now(timezone.utc):
            return api_response(status_code=403, message="Access link expired", error="Forbidden")

    if 'files' not in request.files:
        return api_response(status_code=400, message="No files provided", error="Bad Request")

    files = request.files.getlist('files')
    if not files:
        return api_response(status_code=400, message="No files selected", error="Bad Request")

    try:
        processing_month = datetime.strptime(portal_claims['processing_month'], '%Y-%m-%d').date()
    except ValueError as e:
        return api_response(status_code=400, message="Invalid processing month", error=str(e))

    uploaded = []
    failed = []

    for file in files:
        if file.filename == '':
            continue

        content_type = file.content_type or 'application/octet-stream'
        if content_type not in ALLOWED_TYPES:
            failed.append({'filename': file.filename, 'error': 'Invalid file type'})
            continue

        try:
            file_data = file.read()
            filename = secure_filename(file.filename)

            work_card_data = {
                'business_id': portal_claims['business_id'],
                'site_id': portal_claims['site_id'],
                'employee_id': None,
                'processing_month': processing_month,
                'source': 'RESPONSIBLE_EMPLOYEE',
                'uploaded_by_user_id': None,
                'original_filename': filename,
                'mime_type': content_type,
                'file_size_bytes': len(file_data),
                'review_status': 'NEEDS_REVIEW'
            }

            work_card = work_card_repo.create(**work_card_data)
            file_repo.create(
                work_card_id=work_card.id,
                content_type=content_type,
                file_name=filename,
                image_bytes=file_data
            )
            extraction_repo.create(
                work_card_id=work_card.id,
                status='PENDING'
            )

            uploaded.append({'id': str(work_card.id), 'filename': filename})
        except Exception as e:
            failed.append({'filename': file.filename, 'error': str(e)})

    return api_response(
        data={'uploaded': uploaded, 'failed': failed, 'total': len(uploaded) + len(failed)},
        message=f"Uploaded {len(uploaded)} files"
    )


@public_portal_bp.route('/admin-verify', methods=['POST'])
def admin_verify():
    payload = request.get_json() or {}
    business_code = payload.get('business_code')
    phone_number = payload.get('phone_number')

    if not business_code or not phone_number:
        return api_response(status_code=400, message="business_code and phone_number are required", error="Bad Request")

    ip_address = request.headers.get('X-Forwarded-For', request.remote_addr) or 'unknown'
    if _is_rate_limited(ip_address):
        return api_response(status_code=429, message="Too many attempts. Please try again later.", error="Rate Limit")

    business = business_repo.get_by_code(business_code)
    if not business:
        return api_response(status_code=404, message="Business not found", error="Not Found")

    user = user_repo.get_by_phone(normalize_phone(phone_number), business_id=business.id)
    if not user or user.role not in ('ADMIN', 'OPERATOR_MANAGER') or not user.is_active:
        return api_response(status_code=401, message="Phone verification failed", error="Unauthorized")

    portal_payload = {
        'scope': 'ADMIN_PORTAL_UPLOAD',
        'business_id': str(business.id),
        'user_id': str(user.id),
    }
    session_token = encode_portal_token(portal_payload, expires_in_seconds=86400)

    sites = site_repo.get_active_sites(business_id=business.id)
    response_data = {
        'session_token': session_token,
        'user_name': user.full_name,
        'business_name': business.name,
        'sites': [{'id': str(s.id), 'site_name': s.site_name} for s in sites],
    }
    return api_response(data=response_data, message="Verification successful")


@public_portal_bp.route('/admin-upload', methods=['POST'])
@admin_portal_token_required
def admin_upload_files():
    ALLOWED_TYPES = {
        'image/jpeg',
        'image/jpg',
        'image/png',
        'image/gif',
        'image/webp',
        'application/pdf'
    }

    claims = g.admin_portal_claims
    business_id = claims.get('business_id')

    site_id = request.form.get('site_id') or None
    processing_month_str = request.form.get('processing_month')

    if not processing_month_str:
        return api_response(status_code=400, message="processing_month is required", error="Bad Request")

    if site_id:
        site = site_repo.get_by_id(site_id)
        if not site or str(site.business_id) != business_id:
            return api_response(status_code=403, message="Invalid site", error="Forbidden")

    try:
        processing_month = datetime.strptime(processing_month_str, '%Y-%m-%d').date()
    except ValueError as e:
        return api_response(status_code=400, message="Invalid processing_month format (expected YYYY-MM-DD)", error=str(e))

    if 'files' not in request.files:
        return api_response(status_code=400, message="No files provided", error="Bad Request")

    files = request.files.getlist('files')
    if not files:
        return api_response(status_code=400, message="No files selected", error="Bad Request")

    uploaded = []
    failed = []

    for file in files:
        if file.filename == '':
            continue

        content_type = file.content_type or 'application/octet-stream'
        if content_type not in ALLOWED_TYPES:
            failed.append({'filename': file.filename, 'error': 'Invalid file type'})
            continue

        try:
            file_data = file.read()
            filename = secure_filename(file.filename)

            work_card = work_card_repo.create(
                business_id=business_id,
                site_id=site_id,
                employee_id=None,
                processing_month=processing_month,
                source='ADMIN_PORTAL',
                uploaded_by_user_id=None,
                original_filename=filename,
                mime_type=content_type,
                file_size_bytes=len(file_data),
                review_status='NEEDS_ASSIGNMENT' if not site_id else 'NEEDS_REVIEW',
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

            uploaded.append({'id': str(work_card.id), 'filename': filename})
        except Exception as e:
            failed.append({'filename': file.filename, 'error': str(e)})

    return api_response(
        data={'uploaded': uploaded, 'failed': failed, 'total': len(uploaded) + len(failed)},
        message=f"Uploaded {len(uploaded)} files"
    )
