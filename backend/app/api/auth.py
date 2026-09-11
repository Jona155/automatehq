from flask import Blueprint, request, g
import logging
import traceback
import uuid
from dataclasses import asdict
from datetime import timedelta
from werkzeug.security import check_password_hash
from ..repositories.user_repository import UserRepository
from ..repositories.business_repository import BusinessRepository
from ..auth_utils import encode_auth_token, token_required
from ..services.auth_otp_service import (
    OtpError,
    request_challenge,
    resend_challenge,
    verify_challenge,
)
from ..utils import utc_now
from .utils import api_response, model_to_dict

logger = logging.getLogger(__name__)

auth_bp = Blueprint('auth', __name__, url_prefix='/api/auth')
user_repo = UserRepository()
business_repo = BusinessRepository()


def _user_is_eligible_for_login(user) -> bool:
    if not user or not user.is_active:
        return False
    if user.role == 'APPLICATION_MANAGER':
        return True
    business = business_repo.get_by_id(user.business_id)
    return bool(business and business.is_active)


def _otp_error_response(error: OtpError):
    return api_response(
        status_code=error.status_code,
        message=str(error),
        error=error.__class__.__name__,
    )


def get_user_with_business(user):
    """
    Build user data dict including business context.
    """
    user_data = model_to_dict(user)
    user_data.pop('password_hash', None)

    # APPLICATION_MANAGER users have no business
    if user.business_id is None:
        return user_data

    # Load business and add context
    business = business_repo.get_by_id(user.business_id)
    if business:
        user_data['business'] = {
            'id': str(business.id),
            'name': business.name,
            'code': business.code,
            'is_active': business.is_active,
            'default_month_cutoff_day': business.default_month_cutoff_day,
            'expected_work_cards_per_month': business.expected_work_cards_per_month,
        }

    return user_data


@auth_bp.route('/login', methods=['POST'])
def login():
    """
    User Login
    """
    data = request.get_json()
    if not data or not data.get('email') or not data.get('password'):
        return api_response(status_code=400, message="Missing email or password", error="Bad Request")
        
    try:
        user = user_repo.get_by_email(data.get('email'))
        if not user:
            return api_response(status_code=401, message="Invalid credentials", error="Unauthorized")
            
        if not user.is_active:
            return api_response(status_code=403, message="Account is deactivated", error="Forbidden")

        # APPLICATION_MANAGER users have no business — skip business checks
        if user.role != 'APPLICATION_MANAGER':
            # Validate user's business exists and is active
            business = business_repo.get_by_id(user.business_id)
            if not business:
                return api_response(
                    status_code=403,
                    message="Your organization does not exist in the system",
                    error="Forbidden"
                )

            if not business.is_active:
                return api_response(
                    status_code=403,
                    message="Your organization has been deactivated",
                    error="Forbidden"
                )

        if check_password_hash(user.password_hash, data.get('password')):
            auth_token = encode_auth_token(user.id)
            if isinstance(auth_token, Exception):
                return api_response(status_code=500, message="Failed to generate token", error=str(auth_token))
            
            user_data = get_user_with_business(user)
            
            return api_response(data={
                'token': auth_token,
                'user': user_data
            }, message="Login successful")
        else:
            return api_response(status_code=401, message="Invalid credentials", error="Unauthorized")
            
    except Exception as e:
        return api_response(status_code=500, message="Login failed", error=str(e))


@auth_bp.route('/otp/request', methods=['POST'])
def request_otp():
    """Start passwordless login by sending a six-digit code over WhatsApp."""
    data = request.get_json() or {}
    phone_number = str(data.get('phone_number') or '').strip()
    if not phone_number:
        return api_response(
            status_code=400,
            message="Phone number is required",
            error="Bad Request",
        )

    # The same response shape is returned for unknown/ineligible users so this
    # public endpoint cannot be used as a phone-number directory.
    fake_result = {
        'challenge_id': str(uuid.uuid4()),
        'expires_at': (utc_now() + timedelta(minutes=10)).isoformat(),
        'masked_phone': f"***{''.join(character for character in phone_number if character.isdigit())[-4:]}",
        'resend_after_seconds': 60,
    }

    try:
        user = user_repo.get_by_normalized_phone(phone_number)
        if not _user_is_eligible_for_login(user):
            return api_response(
                data=fake_result,
                message="If the number is registered, a verification code was sent",
                status_code=202,
            )

        forwarded_for = request.headers.get('X-Forwarded-For', '')
        request_ip = forwarded_for.split(',')[0].strip() or request.remote_addr or 'unknown'
        result = request_challenge(user, request_ip)
        return api_response(
            data=asdict(result),
            message="Verification code sent",
            status_code=202,
        )
    except OtpError as error:
        return _otp_error_response(error)
    except Exception:
        logger.exception("Failed to request WhatsApp OTP")
        return api_response(
            status_code=500,
            message="Failed to request verification code",
            error="Internal Server Error",
        )


@auth_bp.route('/otp/verify', methods=['POST'])
def verify_otp():
    """Exchange a valid, single-use OTP challenge for the normal auth JWT."""
    data = request.get_json() or {}
    challenge_id = data.get('challenge_id')
    code = str(data.get('code') or '').strip()
    if not challenge_id or len(code) != 6 or not code.isdigit():
        return api_response(
            status_code=400,
            message="A valid challenge and six-digit code are required",
            error="Bad Request",
        )

    try:
        parsed_id = uuid.UUID(str(challenge_id))
    except (ValueError, TypeError, AttributeError):
        return api_response(status_code=401, message="Invalid verification code", error="Unauthorized")

    try:
        user = verify_challenge(parsed_id, code)
        if not _user_is_eligible_for_login(user):
            return api_response(status_code=403, message="Account is unavailable", error="Forbidden")

        auth_token = encode_auth_token(user.id)
        if isinstance(auth_token, Exception):
            return api_response(status_code=500, message="Failed to generate token", error=str(auth_token))

        return api_response(
            data={'token': auth_token, 'user': get_user_with_business(user)},
            message="Login successful",
        )
    except OtpError as error:
        return _otp_error_response(error)
    except Exception:
        logger.exception("Failed to verify WhatsApp OTP")
        return api_response(status_code=500, message="Verification failed", error="Internal Server Error")


@auth_bp.route('/otp/resend', methods=['POST'])
def resend_otp():
    data = request.get_json() or {}
    challenge_id = data.get('challenge_id')
    try:
        parsed_id = uuid.UUID(str(challenge_id))
    except (ValueError, TypeError, AttributeError):
        return api_response(status_code=401, message="Invalid verification request", error="Unauthorized")

    try:
        result = resend_challenge(parsed_id)
        return api_response(data=asdict(result), message="Verification code sent", status_code=202)
    except OtpError as error:
        return _otp_error_response(error)
    except Exception:
        logger.exception("Failed to resend WhatsApp OTP")
        return api_response(
            status_code=500,
            message="Failed to resend verification code",
            error="Internal Server Error",
        )


@auth_bp.route('/me', methods=['GET'])
@token_required
def get_me():
    """
    Get current user details with business context
    """
    try:
        user = g.current_user
        user_data = get_user_with_business(user)
        return api_response(data=user_data)
    except Exception as e:
        logger.exception("Failed to get current user")
        traceback.print_exc()
        return api_response(status_code=500, message="Failed to get user details", error=str(e))
