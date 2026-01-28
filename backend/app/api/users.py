from flask import Blueprint, request, g
from werkzeug.security import generate_password_hash
from ..repositories.user_repository import UserRepository
from .utils import api_response, model_to_dict
from ..auth_utils import token_required

users_bp = Blueprint('users', __name__, url_prefix='/api/users')
repo = UserRepository()

@users_bp.route('', methods=['GET'])
@token_required
def get_users():
<<<<<<< HEAD
    """Get all users, optionally filtered by role or active status, scoped to tenant."""
=======
    """Get all users in the current business, optionally filtered by role or active status."""
>>>>>>> edd1bb21294eae8a7b37e75977dd739df6834c2d
    role = request.args.get('role')
    only_active = request.args.get('active', 'false').lower() == 'true'
    
    filters = {'business_id': g.current_user.business_id}
    if role:
<<<<<<< HEAD
        filters['role'] = role
    if only_active:
        filters['is_active'] = True
        
    results = repo.get_all(filters=filters)
=======
        results = repo.get_by_role(role, business_id=g.business_id)
        if only_active:
            results = [u for u in results if u.is_active]
    else:
        if only_active:
            results = repo.get_active_users(business_id=g.business_id)
        else:
            results = repo.get_all_for_business(business_id=g.business_id)
>>>>>>> edd1bb21294eae8a7b37e75977dd739df6834c2d
            
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
    """Create a new user in the current business."""
    data = request.get_json()
    if not data:
        return api_response(status_code=400, message="No data provided", error="Bad Request")
        
    try:
<<<<<<< HEAD
        # Enforce scoping and defaults
        data['business_id'] = g.current_user.business_id
        data['role'] = 'ADMIN' # Force Admin role for MVP
        
        # Validation
        if not data.get('full_name'):
             return api_response(status_code=400, message="Full Name is required", error="Bad Request")
        if not data.get('email'):
             return api_response(status_code=400, message="Email is required", error="Bad Request")
        if not data.get('password'):
             return api_response(status_code=400, message="Password is required", error="Bad Request")

        # Check email uniqueness if provided
        existing = repo.get_by_email(data['email'])
        if existing:
             return api_response(status_code=409, message="User with this email already exists", error="Conflict")

        # Check phone uniqueness if provided
        if data.get('phone_number'):
            existing_phone = repo.get_by_phone(data['phone_number'])
            if existing_phone:
                 return api_response(status_code=409, message="User with this phone number already exists", error="Conflict")

        # Hash password
        data['password_hash'] = generate_password_hash(data.pop('password'))
=======
        # Check email uniqueness if provided (globally unique)
        if data.get('email') and repo.get_by_email(data['email']):
             return api_response(status_code=409, message="User with this email already exists", error="Conflict")

        # Check phone uniqueness if provided (globally unique)
        if data.get('phone_number') and repo.get_by_phone(data['phone_number']):
             return api_response(status_code=409, message="User with this phone number already exists", error="Conflict")

        # Hash password if provided
        if 'password' in data:
            data['password_hash'] = generate_password_hash(data.pop('password'))
        
        # Inject business_id from context
        data['business_id'] = g.business_id
>>>>>>> edd1bb21294eae8a7b37e75977dd739df6834c2d
            
        user = repo.create(**data)
        
        user_dict = model_to_dict(user)
        user_dict.pop('password_hash', None)
        
        return api_response(data=user_dict, message="User created successfully", status_code=201)
    except Exception as e:
        return api_response(status_code=500, message="Failed to create user", error=str(e))

@users_bp.route('/<uuid:user_id>', methods=['GET'])
@token_required
def get_user(user_id):
    """Get a specific user by ID (must belong to current business)."""
    user = repo.get_by_id(user_id)
<<<<<<< HEAD
    
    # Scoping check
    if not user or user.business_id != g.current_user.business_id:
=======
    if not user or user.business_id != g.business_id:
>>>>>>> edd1bb21294eae8a7b37e75977dd739df6834c2d
        return api_response(status_code=404, message="User not found", error="Not Found")
        
    user_dict = model_to_dict(user)
    user_dict.pop('password_hash', None)
    
    return api_response(data=user_dict)

@users_bp.route('/<uuid:user_id>', methods=['PUT'])
@token_required
def update_user(user_id):
    """Update a user (must belong to current business)."""
    # Verify ownership
    user = repo.get_by_id(user_id)
    if not user or user.business_id != g.business_id:
        return api_response(status_code=404, message="User not found", error="Not Found")
    
    data = request.get_json()
    if not data:
        return api_response(status_code=400, message="No data provided", error="Bad Request")
        
    user = repo.get_by_id(user_id)
    if not user or user.business_id != g.current_user.business_id:
        return api_response(status_code=404, message="User not found", error="Not Found")

    try:
        # Prevent editing restricted fields
        data.pop('role', None)
        data.pop('password', None)
        data.pop('business_id', None)

        # Check unique constraints if changing email/phone
        if data.get('email'):
            existing = repo.get_by_email(data['email'])
            if existing and str(existing.id) != str(user_id):
                return api_response(status_code=409, message="User with this email already exists", error="Conflict")
                
        if data.get('phone_number'):
            existing = repo.get_by_phone(data['phone_number'])
            if existing and str(existing.id) != str(user_id):
                return api_response(status_code=409, message="User with this phone number already exists", error="Conflict")

<<<<<<< HEAD
=======
        # Prevent changing business_id
        if 'business_id' in data:
            del data['business_id']

        # Handle password update
        if 'password' in data:
            data['password_hash'] = generate_password_hash(data.pop('password'))

>>>>>>> edd1bb21294eae8a7b37e75977dd739df6834c2d
        updated_user = repo.update(user_id, **data)
            
        user_dict = model_to_dict(updated_user)
        user_dict.pop('password_hash', None)
            
        return api_response(data=user_dict, message="User updated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to update user", error=str(e))

@users_bp.route('/<uuid:user_id>', methods=['DELETE'])
@token_required
def delete_user(user_id):
<<<<<<< HEAD
    """Delete a user (soft delete)."""
    user = repo.get_by_id(user_id)
    if not user or user.business_id != g.current_user.business_id:
        return api_response(status_code=404, message="User not found", error="Not Found")
    
    # Prevent self-delete
    if str(user.id) == str(g.current_user.id):
        return api_response(status_code=400, message="Cannot delete your own user account", error="Bad Request")

=======
    """Delete a user (must belong to current business)."""
    # Verify ownership
    user = repo.get_by_id(user_id)
    if not user or user.business_id != g.business_id:
        return api_response(status_code=404, message="User not found", error="Not Found")
    
>>>>>>> edd1bb21294eae8a7b37e75977dd739df6834c2d
    try:
        success = repo.deactivate(user_id)
        if not success:
             # Should not happen given check above, but for safety
            return api_response(status_code=404, message="User not found", error="Not Found")
            
        return api_response(message="User deleted successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to delete user", error=str(e))

@users_bp.route('/<uuid:user_id>/deactivate', methods=['POST'])
@token_required
def deactivate_user(user_id):
<<<<<<< HEAD
    """Deactivate a user."""
    user = repo.get_by_id(user_id)
    if not user or user.business_id != g.current_user.business_id:
        return api_response(status_code=404, message="User not found", error="Not Found")
    
=======
    """Deactivate a user (must belong to current business)."""
>>>>>>> edd1bb21294eae8a7b37e75977dd739df6834c2d
    try:
        success = repo.deactivate(user_id, business_id=g.business_id)
        if not success:
            return api_response(status_code=404, message="User not found", error="Not Found")
            
        return api_response(message="User deactivated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to deactivate user", error=str(e))

@users_bp.route('/<uuid:user_id>/activate', methods=['POST'])
@token_required
def activate_user(user_id):
<<<<<<< HEAD
    """Activate a user."""
    user = repo.get_by_id(user_id)
    if not user or user.business_id != g.current_user.business_id:
        return api_response(status_code=404, message="User not found", error="Not Found")

=======
    """Activate a user (must belong to current business)."""
>>>>>>> edd1bb21294eae8a7b37e75977dd739df6834c2d
    try:
        success = repo.activate(user_id, business_id=g.business_id)
        if not success:
            return api_response(status_code=404, message="User not found", error="Not Found")
            
        return api_response(message="User activated successfully")
    except Exception as e:
        return api_response(status_code=500, message="Failed to activate user", error=str(e))
