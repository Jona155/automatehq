from flask import Blueprint, request, g
from werkzeug.security import check_password_hash
from ..repositories.user_repository import UserRepository
from ..auth_utils import encode_auth_token, token_required
from .utils import api_response, model_to_dict

auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')
repo = UserRepository()

@auth_bp.route('/login', methods=['POST'])
def login():
    """
    User Login
    """
    data = request.get_json()
    if not data or not data.get('email') or not data.get('password'):
        return api_response(status_code=400, message="Missing email or password", error="Bad Request")
        
    try:
        user = repo.get_by_email(data.get('email'))
        if not user:
            return api_response(status_code=401, message="Invalid credentials", error="Unauthorized")
            
        if not user.is_active:
             return api_response(status_code=403, message="Account is deactivated", error="Forbidden")

        if check_password_hash(user.password_hash, data.get('password')):
            auth_token = encode_auth_token(user.id)
            if isinstance(auth_token, Exception):
                 return api_response(status_code=500, message="Failed to generate token", error=str(auth_token))
            
            user_data = model_to_dict(user)
            user_data.pop('password_hash', None)
            
            return api_response(data={
                'token': auth_token,
                'user': user_data
            }, message="Login successful")
        else:
            return api_response(status_code=401, message="Invalid credentials", error="Unauthorized")
            
    except Exception as e:
        return api_response(status_code=500, message="Login failed", error=str(e))

@auth_bp.route('/me', methods=['GET'])
@token_required
def get_me():
    """
    Get current user details
    """
    user = g.current_user
    user_data = model_to_dict(user)
    user_data.pop('password_hash', None)
    return api_response(data=user_data)
