from flask import Blueprint, request, g
from ..repositories.site_repository import SiteRepository
from .utils import api_response, model_to_dict, models_to_list
from ..auth_utils import token_required

sites_bp = Blueprint('sites', __name__, url_prefix='/api/sites')
repo = SiteRepository()

@sites_bp.route('', methods=['GET'])
@token_required
def get_sites():
    """Get all sites, optionally with employee counts, scoped to tenant."""
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
