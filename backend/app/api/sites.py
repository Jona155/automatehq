from flask import Blueprint, request, g
import os
import uuid
import traceback
import logging
from datetime import datetime, timedelta, timezone
import secrets
from sqlalchemy import and_, or_, func, case
from sqlalchemy.orm import joinedload
from twilio.rest import Client
from ..repositories.site_repository import SiteRepository
from ..repositories.employee_repository import EmployeeRepository
from ..repositories.work_card_repository import WorkCardRepository
from ..repositories.work_card_extraction_repository import WorkCardExtractionRepository
from ..repositories.upload_access_request_repository import UploadAccessRequestRepository
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
work_card_repo = WorkCardRepository()
extraction_repo = WorkCardExtractionRepository()
access_repo = UploadAccessRequestRepository()

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
        
        # Get all employees for this site
        employees = employee_repo.get_by_site(site_id, g.business_id)
        
        # Build result with status for each employee
        result = []
        for employee in employees:
            # Get work cards for this employee and month
            work_cards = work_card_repo.get_by_employee_month(employee.id, month, g.business_id)
            
            # Determine status
            status = 'NO_UPLOAD'
            work_card_id = None
            
            if work_cards:
                # Use the latest work card
                work_card = work_cards[-1]
                work_card_id = str(work_card.id)
                
                # Get extraction status (may be None if user has not triggered extraction)
                extraction = extraction_repo.get_by_work_card(work_card.id)
                
                if extraction:
                    if extraction.status == 'FAILED':
                        status = 'FAILED'
                    elif extraction.status in ['PENDING', 'RUNNING']:
                        status = 'PENDING'
                    elif extraction.status == 'DONE':
                        if work_card.review_status == 'APPROVED':
                            status = 'APPROVED'
                        else:
                            status = 'EXTRACTED'
                else:
                    # Work card exists but extraction not yet triggered - show as pending
                    status = 'PENDING'
            
            employee_dict = model_to_dict(employee)
            result.append({
                'employee': employee_dict,
                'status': status,
                'work_card_id': work_card_id
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
        # Parse processing_month
        month = datetime.strptime(processing_month, '%Y-%m-%d').date()
        
        # Get employees for this site
        if include_inactive:
            employees = employee_repo.get_by_site(site_id, g.business_id)
        else:
            employees = employee_repo.get_active_by_site(site_id, g.business_id)
        
        # Build matrix structure
        matrix = {}
        status_map = {}  # employee_id -> review_status
        
        # For performance, fetch all relevant work cards and day entries in a single query
        # We'll use a subquery to get the "best" work card for each employee
        # (latest APPROVED if available, else latest NEEDS_REVIEW)
        
        # Subquery to rank work cards by preference
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
        
        # Get the top-ranked card for each employee
        best_cards = db.session.query(
            ranked_cards.c.work_card_id
        ).filter(
            ranked_cards.c.rank == 1
        ).subquery()
        
        # Fetch day entries for the best cards
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
        
        # Build a lookup: work_card_id -> (employee_id, review_status)
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
        
        # Build matrix from day entries
        for entry in day_entries:
            work_card_id_str = str(entry.work_card_id)
            employee_id = work_card_to_employee.get(work_card_id_str)
            
            if employee_id:
                if employee_id not in matrix:
                    matrix[employee_id] = {}
                
                if entry.total_hours is not None:
                    matrix[employee_id][entry.day_of_month] = float(entry.total_hours)
        
        # Return employees, matrix, and status_map
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
    token = None
    for _ in range(5):
        candidate = secrets.token_urlsafe(32)
        if not access_repo.token_exists(candidate):
            token = candidate
            break
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

    url = f"{request.host_url.rstrip('/')}/portal/{token}"
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

    if raw_phone.startswith('0'):
        formatted_phone = '+972' + raw_phone[1:]
    else:
        formatted_phone = '+' + raw_phone

    try:
        account_sid = os.environ.get('TWILIO_ACCOUNT_SID')
        auth_token = os.environ.get('TWILIO_AUTH_TOKEN')
        from_number = os.environ.get('TWILIO_WHATSAPP_NUMBER')

        if not all([account_sid, auth_token, from_number]):
            logger.error("Twilio credentials missing")
            return api_response(status_code=500, message="Server configuration error", error="Twilio config missing")

        client = Client(account_sid, auth_token)

        url = f"{request.host_url.rstrip('/')}/portal/{access_request.token}"
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
