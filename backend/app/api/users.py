from flask import Blueprint, request
from werkzeug.security import generate_password_hash
from ..repositories.user_repository import UserRepository
from .utils import api_response, model_to_dict, models_to_list
from ..auth_utils import token_required

users_bp = Blueprint('users', __name__, url_prefix='/api/users')
repo = UserRepository()

@users_bp.route('', methods=['GET'])
@token_required
def get_users():
    """Get all users, optionally filtered by role or active status."""
    role = request.args.get('role')
    only_active = request.args.get('active', 'false').lower() == 'true'
    
    if role:
        results = repo.get_by_role(role)
        if only_active:
            results = [u for u in results if u.is_active]
    else:
        if only_active:
            results = repo.get_active_users()
        else:
            results = repo.get_all()
            
    # Remove password_hash from response
    data = []
    for user in results:
        user_dict = model_to_dict(user)
        user_dict.pop('password_hash', None)
        data.append(user_dict)
        
    return api_response(data=data)

@users_bp.route('', methods=['POST'])
@token_required
def create_user():
    """Create a new user."""
    data = request.get_json()
    if not data:
        return api_response(status_code=400, message="No data provided", error="Bad Request")
        
    try:
        # Check email uniqueness if provided
        if data.get('email') and repo.get_by_email(data['email']):
             return api_response(status_code=409, message="User with this email already exists", error="Conflict")

        # Check phone uniqueness if provided
        if data.get('phone_number') and repo.get_by_phone(data['phone_number']):
             return api_response(status_code=409, message="User with this phone number already exists", error="Conflict")

        # Hash password if provided
        if 'password' in data:
            data['password_hash'] = generate_password_hash(data.pop('password'))
            
        user = repo.create(**data)
        
        user_dict = model_to_dict(user)
        user_dict.pop('password_hash', None)
        
        return api_response(data=user_dict, message="User created successfully", status_code=201)
    except Exception as e:
        return api_response(status_code=500, message="Failed to create user", error=str(e))

@users_bp.route('/<uuid:user_id>', methods=['GET'])
@token_required
def get_user(user_id):
    """Get a specific user by ID."""
    user = repo.get_by_id(user_id)
    if not user:
        return api_response(status_code=404, message="User not found", error="Not Found")
        
    user_dict = model_to_dict(user)
    user_dict.pop('password_hash', None)
    
    return api_response(data=user_dict)

@users_bp.route('/<uuid:user_id>', methods=['PUT'])
@token_required
def update_user(user_id):
    """Update a user."""
    data = request.get_json()
    if not data:
        return api_response(status_code=400, message="No data provided", error="Bad Request")
        
    try:
        # Check unique constraints if changing email/phone
        if data.get('email'):
            existing = repo.get_by_email(data['email'])
            if existing and str(existing.id) != str(user_id):
                return api_response(status_code=409, message="User with this email already exists", error="Conflict")
                
        if data.get('phone_number'):
            existing = repo.get_by_phone(data['phone_number'])
            if existing and str(existing.id) != str(user_id):
                return api_response(status_code=409, message="User with this phone number already exists", error="Conflict")

        # Handle password update
        if 'password' in data:
            data['password_hash'] = generate_password_hash(data.pop('password'))

        updated_user = repo.update(user_id, **data)
        if not updated_user:
            return api_response(status_code=404, message="User not found", error="Not Found")
            
        user_dict = model_to_dict(updated_user)
        user_dict.pop('password_hash', None)
            
        return api_response(data=user_dict, message="User updated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to update user", error=str(e))

@users_bp.route('/<uuid:user_id>', methods=['DELETE'])
@token_required
def delete_user(user_id):
    """Delete a user."""
    try:
        success = repo.delete(user_id)
        if not success:
            return api_response(status_code=404, message="User not found", error="Not Found")
            
        return api_response(message="User deleted successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to delete user", error=str(e))

@users_bp.route('/<uuid:user_id>/deactivate', methods=['POST'])
@token_required
def deactivate_user(user_id):
    """Deactivate a user."""
    try:
        success = repo.deactivate(user_id)
        if not success:
            return api_response(status_code=404, message="User not found", error="Not Found")
            
        return api_response(message="User deactivated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to deactivate user", error=str(e))

@users_bp.route('/<uuid:user_id>/activate', methods=['POST'])
@token_required
def activate_user(user_id):
    """Activate a user."""
    try:
        success = repo.activate(user_id)
        if not success:
            return api_response(status_code=404, message="User not found", error="Not Found")
            
        return api_response(message="User activated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to activate user", error=str(e))
