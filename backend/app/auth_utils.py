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
        except Exception:
             return jsonify({'message': 'Token is invalid', 'success': False, 'error': 'Unauthorized'}), 401

        # Pass current_user to the route if it accepts it? 
        # Or just store in g? Flask's g is better.
        # But for now, the plan says "sets current_user in context (or passes it to the route)".
        # I'll just rely on `g` or passing it? 
        # Standard flask pattern often uses `current_user` from flask_login, but here I can use `g`.
        from flask import g
        g.current_user = current_user
        
        return f(*args, **kwargs)

    return decorated
