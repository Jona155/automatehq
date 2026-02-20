"""
Business API Endpoints

Provides CRUD operations for managing businesses (multi-tenancy entities).
Restricted to APPLICATION_MANAGER role only.
"""
from flask import Blueprint, request
from werkzeug.security import generate_password_hash
from ..repositories.business_repository import BusinessRepository
from ..repositories.user_repository import UserRepository
from .utils import api_response, model_to_dict, models_to_list
from ..auth_utils import token_required, role_required

businesses_bp = Blueprint('businesses', __name__, url_prefix='/api/businesses')
repo = BusinessRepository()
user_repo = UserRepository()

@businesses_bp.route('', methods=['GET'])
@token_required
@role_required('APPLICATION_MANAGER')
def get_businesses():
    """Get all businesses, optionally filtered by active status."""
    only_active = request.args.get('active', 'false').lower() == 'true'

    if only_active:
        businesses = repo.get_active_businesses()
    else:
        businesses = repo.get_all()

    return api_response(data=models_to_list(businesses))

@businesses_bp.route('', methods=['POST'])
@token_required
@role_required('APPLICATION_MANAGER')
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
@role_required('APPLICATION_MANAGER')
def get_business(business_id):
    """Get a specific business by ID."""
    business = repo.get_by_id(business_id)
    if not business:
        return api_response(status_code=404, message="Business not found", error="Not Found")

    return api_response(data=model_to_dict(business))

@businesses_bp.route('/<uuid:business_id>', methods=['PUT'])
@token_required
@role_required('APPLICATION_MANAGER')
def update_business(business_id):
    """Update a business."""
    data = request.get_json()
    if not data:
        return api_response(status_code=400, message="No data provided", error="Bad Request")

    try:
        # Don't allow changing primary key fields
        data.pop('id', None)

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
@role_required('APPLICATION_MANAGER')
def delete_business(business_id):
    """Deactivate (soft delete) a business."""
    try:
        # Soft delete by deactivating
        success = repo.deactivate(business_id)
        if not success:
            return api_response(status_code=404, message="Business not found", error="Not Found")

        return api_response(message="Business deactivated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to deactivate business", error=str(e))


@businesses_bp.route('/<uuid:business_id>/activate', methods=['POST'])
@token_required
@role_required('APPLICATION_MANAGER')
def activate_business(business_id):
    """Activate a business."""
    try:
        business = repo.update(business_id, is_active=True)
        if not business:
            return api_response(status_code=404, message="Business not found", error="Not Found")

        return api_response(message="Business activated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to activate business", error=str(e))


@businesses_bp.route('/<uuid:business_id>/deactivate', methods=['POST'])
@token_required
@role_required('APPLICATION_MANAGER')
def deactivate_business(business_id):
    """Deactivate a business."""
    try:
        success = repo.deactivate(business_id)
        if not success:
            return api_response(status_code=404, message="Business not found", error="Not Found")
        return api_response(message="Business deactivated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to deactivate business", error=str(e))


@businesses_bp.route('/<uuid:business_id>/users', methods=['GET'])
@token_required
@role_required('APPLICATION_MANAGER')
def get_business_users(business_id):
    """Get all users for a specific business."""
    business = repo.get_by_id(business_id)
    if not business:
        return api_response(status_code=404, message="Business not found", error="Not Found")

    users = user_repo.get_all_for_business(business_id)
    data = []
    for user in users:
        user_dict = model_to_dict(user)
        user_dict.pop('password_hash', None)
        data.append(user_dict)

    return api_response(data=data)


@businesses_bp.route('/<uuid:business_id>/users', methods=['POST'])
@token_required
@role_required('APPLICATION_MANAGER')
def create_business_user(business_id):
    """Create a new user for a specific business."""
    business = repo.get_by_id(business_id)
    if not business:
        return api_response(status_code=404, message="Business not found", error="Not Found")

    data = request.get_json()
    if not data:
        return api_response(status_code=400, message="No data provided", error="Bad Request")

    if not data.get('full_name'):
        return api_response(status_code=400, message="Full name is required", error="Bad Request")
    if not data.get('email'):
        return api_response(status_code=400, message="Email is required", error="Bad Request")
    if not data.get('password'):
        return api_response(status_code=400, message="Password is required", error="Bad Request")

    # Validate role
    allowed_roles = {'ADMIN', 'OPERATOR_MANAGER'}
    role = data.get('role', 'ADMIN')
    if role not in allowed_roles:
        return api_response(status_code=400, message=f"Invalid role. Must be one of: {', '.join(sorted(allowed_roles))}", error="Bad Request")

    try:
        # Check email uniqueness (globally unique)
        if user_repo.get_by_email(data['email']):
            return api_response(status_code=409, message="User with this email already exists", error="Conflict")

        # Check phone uniqueness if provided
        if data.get('phone_number'):
            if user_repo.get_by_phone(data['phone_number']):
                return api_response(status_code=409, message="User with this phone number already exists", error="Conflict")

        user = user_repo.create(
            business_id=business_id,
            full_name=data['full_name'],
            email=data['email'],
            password_hash=generate_password_hash(data['password'], method='pbkdf2:sha256'),
            role=role,
            phone_number=data.get('phone_number'),
        )

        user_dict = model_to_dict(user)
        user_dict.pop('password_hash', None)

        return api_response(data=user_dict, message="User created successfully", status_code=201)
    except Exception as e:
        return api_response(status_code=500, message="Failed to create user", error=str(e))
