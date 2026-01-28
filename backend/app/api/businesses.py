from flask import Blueprint, request
from ..repositories.business_repository import BusinessRepository
from .utils import api_response, model_to_dict, models_to_list
from ..auth_utils import token_required

businesses_bp = Blueprint('businesses', __name__, url_prefix='/api/businesses')
repo = BusinessRepository()

@businesses_bp.route('', methods=['GET'])
@token_required
def get_businesses():
    """Get all businesses."""
    only_active = request.args.get('active', 'false').lower() == 'true'
    
    if only_active:
        businesses = repo.get_active_businesses()
    else:
        businesses = repo.get_all()
        
    return api_response(data=models_to_list(businesses))

@businesses_bp.route('', methods=['POST'])
@token_required
def create_business():
    """Create a new business."""
    data = request.get_json()
    if not data:
        return api_response(status_code=400, message="No data provided", error="Bad Request")
        
    # Validate required fields
    if not data.get('name') or not data.get('code'):
         return api_response(status_code=400, message="Name and code are required", error="Bad Request")

    try:
        # Check if business with code exists
        if repo.get_by_code(data.get('code')):
             return api_response(status_code=409, message="Business with this code already exists", error="Conflict")
             
        # Check if business with name exists
        if repo.get_by_name(data.get('name')):
             return api_response(status_code=409, message="Business with this name already exists", error="Conflict")

        business = repo.create(**data)
        return api_response(data=model_to_dict(business), message="Business created successfully", status_code=201)
    except Exception as e:
        return api_response(status_code=500, message="Failed to create business", error=str(e))

@businesses_bp.route('/<uuid:business_id>', methods=['GET'])
@token_required
def get_business(business_id):
    """Get a specific business by ID."""
    business = repo.get_by_id(business_id)
    if not business:
        return api_response(status_code=404, message="Business not found", error="Not Found")
        
    return api_response(data=model_to_dict(business))

@businesses_bp.route('/<uuid:business_id>', methods=['PUT'])
@token_required
def update_business(business_id):
    """Update a business."""
    data = request.get_json()
    if not data:
        return api_response(status_code=400, message="No data provided", error="Bad Request")
        
    try:
        # If updating code, check uniqueness
        if 'code' in data:
            existing = repo.get_by_code(data['code'])
            if existing and str(existing.id) != str(business_id):
                return api_response(status_code=409, message="Business with this code already exists", error="Conflict")

        # If updating name, check uniqueness
        if 'name' in data:
            existing = repo.get_by_name(data['name'])
            if existing and str(existing.id) != str(business_id):
                return api_response(status_code=409, message="Business with this name already exists", error="Conflict")

        updated_business = repo.update(business_id, **data)
        if not updated_business:
            return api_response(status_code=404, message="Business not found", error="Not Found")
            
        return api_response(data=model_to_dict(updated_business), message="Business updated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to update business", error=str(e))

@businesses_bp.route('/<uuid:business_id>', methods=['DELETE'])
@token_required
def delete_business(business_id):
    """Deactivate (soft delete) a business."""
    try:
        success = repo.deactivate(business_id)
        if not success:
            return api_response(status_code=404, message="Business not found", error="Not Found")
            
        return api_response(message="Business deactivated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to deactivate business", error=str(e))
