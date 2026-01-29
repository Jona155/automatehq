from flask import Blueprint, request, g
import traceback
from datetime import datetime
from sqlalchemy import and_, or_, func, case
from sqlalchemy.orm import joinedload
from ..repositories.site_repository import SiteRepository
from ..repositories.employee_repository import EmployeeRepository
from ..repositories.work_card_repository import WorkCardRepository
from ..repositories.work_card_extraction_repository import WorkCardExtractionRepository
from .utils import api_response, model_to_dict, models_to_list
from ..auth_utils import token_required
from ..models.work_cards import WorkCard, WorkCardExtraction, WorkCardDayEntry
from ..models.sites import Employee
from ..extensions import db

sites_bp = Blueprint('sites', __name__, url_prefix='/api/sites')
repo = SiteRepository()
employee_repo = EmployeeRepository()
work_card_repo = WorkCardRepository()
extraction_repo = WorkCardExtractionRepository()

@sites_bp.route('', methods=['GET'])
@token_required
def get_sites():
    """Get all sites, optionally with employee counts, scoped to tenant."""
    try:
        include_counts = request.args.get('include_counts', 'false').lower() == 'true'
        only_active = request.args.get('active', 'false').lower() == 'true'
        
        # Always scope to current business
        business_id = g.current_user.business_id
        
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
        data['business_id'] = g.current_user.business_id
        
        # Validation
        if not data.get('site_name'):
            return api_response(status_code=400, message="Site name is required", error="Bad Request")
        
        # Check if site with name exists within tenant
        existing = repo.get_by_name_and_business(data['site_name'], g.current_user.business_id)
        if existing:
             return api_response(status_code=409, message="Site with this name already exists", error="Conflict")

        site = repo.create(**data)
        return api_response(data=model_to_dict(site), message="Site created successfully", status_code=201)
    except Exception as e:
        return api_response(status_code=500, message="Failed to create site", error=str(e))

@sites_bp.route('/<uuid:site_id>', methods=['GET'])
@token_required
def get_site(site_id):
    """Get a specific site by ID, scoped to tenant."""
    site = repo.get_by_id(site_id)
    if not site or site.business_id != g.current_user.business_id:
        return api_response(status_code=404, message="Site not found", error="Not Found")
        
    return api_response(data=model_to_dict(site))

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
        if not site or site.business_id != g.current_user.business_id:
            return api_response(status_code=404, message="Site not found", error="Not Found")
        
        # Don't allow changing business_id
        data.pop('business_id', None)
        
        updated_site = repo.update(site_id, **data)
        if not updated_site:
            return api_response(status_code=404, message="Site not found", error="Not Found")
            
        return api_response(data=model_to_dict(updated_site), message="Site updated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to update site", error=str(e))

@sites_bp.route('/<uuid:site_id>', methods=['DELETE'])
@token_required
def delete_site(site_id):
    """Delete a site, scoped to tenant."""
    try:
        # Verify site belongs to user's business
        site = repo.get_by_id(site_id)
        if not site or site.business_id != g.current_user.business_id:
            return api_response(status_code=404, message="Site not found", error="Not Found")
        
        # We might want to just mark as inactive instead of deleting if there are related records
        # But BaseRepository.delete does a hard delete. 
        # For now, let's assume hard delete is requested, but catch FK errors
        success = repo.delete(site_id)
        if not success:
            return api_response(status_code=404, message="Site not found", error="Not Found")
            
        return api_response(message="Site deleted successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to delete site", error=str(e))

@sites_bp.route('/<uuid:site_id>/employee-upload-status', methods=['GET'])
@token_required
def get_employee_upload_status(site_id):
    """Get employee upload status for a site and month."""
    # Verify site belongs to user's business
    site = repo.get_by_id(site_id)
    if not site or site.business_id != g.current_user.business_id:
        return api_response(status_code=404, message="Site not found", error="Not Found")
    
    processing_month = request.args.get('processing_month')
    if not processing_month:
        return api_response(status_code=400, message="processing_month is required", error="Bad Request")
    
    try:
        # Parse processing_month
        month = datetime.strptime(processing_month, '%Y-%m-%d').date()
        
        # Get all employees for this site
        employees = employee_repo.get_by_site(site_id, g.current_user.business_id)
        
        # Build result with status for each employee
        result = []
        for employee in employees:
            # Get work cards for this employee and month
            work_cards = work_card_repo.get_by_employee_month(employee.id, month, g.current_user.business_id)
            
            # Determine status
            status = 'NO_UPLOAD'
            work_card_id = None
            
            if work_cards:
                # Use the latest work card
                work_card = work_cards[-1]
                work_card_id = str(work_card.id)
                
                # Get extraction status
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
        traceback.print_exc()
        return api_response(status_code=500, message="Failed to get employee upload status", error=str(e))

@sites_bp.route('/<uuid:site_id>/matrix', methods=['GET'])
@token_required
def get_hours_matrix(site_id):
    """Get hours matrix for a site and month with performance optimization."""
    # Verify site belongs to user's business
    site = repo.get_by_id(site_id)
    if not site or site.business_id != g.current_user.business_id:
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
            employees = employee_repo.get_by_site(site_id, g.current_user.business_id)
        else:
            employees = employee_repo.get_active_by_site(site_id, g.current_user.business_id)
        
        # Build matrix structure
        matrix = {}
        
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
            WorkCard.business_id == g.current_user.business_id,
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
        
        # Build a lookup: work_card_id -> employee_id
        work_card_to_employee = {}
        cards_query = db.session.query(
            WorkCard.id,
            WorkCard.employee_id
        ).filter(
            WorkCard.id.in_(db.session.query(best_cards.c.work_card_id))
        ).all()
        
        for card_id, employee_id in cards_query:
            work_card_to_employee[str(card_id)] = str(employee_id)
        
        # Build matrix from day entries
        for entry in day_entries:
            work_card_id_str = str(entry.work_card_id)
            employee_id = work_card_to_employee.get(work_card_id_str)
            
            if employee_id:
                if employee_id not in matrix:
                    matrix[employee_id] = {}
                
                if entry.total_hours is not None:
                    matrix[employee_id][entry.day_of_month] = float(entry.total_hours)
        
        # Return employees and matrix
        return api_response(data={
            'employees': models_to_list(employees),
            'matrix': matrix
        })
    except ValueError as e:
        return api_response(status_code=400, message="Invalid date format. Use YYYY-MM-DD", error=str(e))
    except Exception as e:
        traceback.print_exc()
        return api_response(status_code=500, message="Failed to get hours matrix", error=str(e))
