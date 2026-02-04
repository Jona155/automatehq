import os
import jwt
from datetime import datetime, timedelta, timezone
from functools import wraps
from flask import request, jsonify, current_app
from .repositories.user_repository import UserRepository

def encode_auth_token(user_id):
    """
    Generates the Auth Token
    :return: string
    """
    try:
        payload = {
            'exp': datetime.now(timezone.utc) + timedelta(seconds=int(os.environ.get('JWT_ACCESS_TOKEN_EXPIRES', 86400))),
            'iat': datetime.now(timezone.utc),
            'sub': str(user_id)
        }
        return jwt.encode(
            payload,
            os.environ.get('JWT_SECRET_KEY'),
            algorithm='HS256'
        )
    except Exception as e:
        return e

def decode_auth_token(auth_token):
    """
    Decodes the auth token
    :param auth_token:
    :return: integer|string
    """
    try:
        payload = jwt.decode(auth_token, os.environ.get('JWT_SECRET_KEY'), algorithms=['HS256'])
        return payload['sub']
    except jwt.ExpiredSignatureError:
        return 'Signature expired. Please log in again.'
    except jwt.InvalidTokenError:
        return 'Invalid token. Please log in again.'

def encode_portal_token(payload: dict, expires_in_seconds: int = 3600):
    try:
        secret = os.environ.get('PORTAL_JWT_SECRET_KEY') or os.environ.get('JWT_SECRET_KEY')
        token_payload = {
            **payload,
            'exp': datetime.now(timezone.utc) + timedelta(seconds=expires_in_seconds),
            'iat': datetime.now(timezone.utc),
        }
        return jwt.encode(token_payload, secret, algorithm='HS256')
    except Exception as e:
        return e

def decode_portal_token(token: str):
    try:
        secret = os.environ.get('PORTAL_JWT_SECRET_KEY') or os.environ.get('JWT_SECRET_KEY')
        return jwt.decode(token, secret, algorithms=['HS256'])
    except jwt.ExpiredSignatureError:
        return 'Portal token expired.'
    except jwt.InvalidTokenError:
        return 'Invalid portal token.'

def portal_token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header:
            return jsonify({'message': 'Token is missing', 'success': False, 'error': 'Unauthorized'}), 401

        try:
            auth_token = auth_header.split(" ")[1]
        except IndexError:
            return jsonify({'message': 'Token is invalid', 'success': False, 'error': 'Unauthorized'}), 401

        resp = decode_portal_token(auth_token)
        if isinstance(resp, str):
            return jsonify({'message': resp, 'success': False, 'error': 'Unauthorized'}), 401

        if resp.get('scope') != 'RESPONSIBLE_EMPLOYEE_UPLOAD':
            return jsonify({'message': 'Invalid portal scope', 'success': False, 'error': 'Forbidden'}), 403

        from flask import g
        g.portal_claims = resp
        return f(*args, **kwargs)

    return decorated

def token_required(f):
    @wraps(f)
    def decorated(*args, **kwargs):
        auth_header = request.headers.get('Authorization')
        if not auth_header:
            return jsonify({'message': 'Token is missing', 'success': False, 'error': 'Unauthorized'}), 401
        
        try:
            auth_token = auth_header.split(" ")[1]
        except IndexError:
            return jsonify({'message': 'Token is invalid', 'success': False, 'error': 'Unauthorized'}), 401

        resp = decode_auth_token(auth_token)
        if not isinstance(resp, str) or len(resp) != 36: # Check if it looks like a UUID string or error message
             # If resp is an error message, it will be a string, but likely not a UUID length (36) or format.
             # Actually, simpler to check if it matches the error strings or is a valid UUID.
             # But UUID is 36 chars. Error messages are longer or shorter?
             # "Signature expired. Please log in again." (38 chars)
             # "Invalid token. Please log in again." (35 chars)
             # Let's just check if it's one of the error messages.
             if resp == 'Signature expired. Please log in again.' or resp == 'Invalid token. Please log in again.':
                return jsonify({'message': resp, 'success': False, 'error': 'Unauthorized'}), 401
        
        # Determine if resp is a user_id (UUID)
        try:
            repo = UserRepository()
            current_user = repo.get_by_id(resp)
            if not current_user:
                 return jsonify({'message': 'User not found', 'success': False, 'error': 'Unauthorized'}), 401
            
            # Verify user's business exists and is active
            from .repositories.business_repository import BusinessRepository
            business_repo = BusinessRepository()
            business = business_repo.get_by_id(current_user.business_id)
            
            if not business:
                return jsonify({
                    'message': 'Your organization does not exist in the system',
                    'success': False,
                    'error': 'Forbidden'
                }), 403
            
            if not business.is_active:
                return jsonify({
                    'message': 'Your organization has been deactivated',
                    'success': False,
                    'error': 'Forbidden'
                }), 403
                
        except Exception:
             return jsonify({'message': 'Token is invalid', 'success': False, 'error': 'Unauthorized'}), 401

        # Store user and business context in Flask's g object
        from flask import g
        g.current_user = current_user
        g.business_id = current_user.business_id
        
        return f(*args, **kwargs)

    return decorated
