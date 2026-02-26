import logging
from datetime import date
from flask import Blueprint, request, g
from ..auth_utils import token_required
from ..repositories.telegram_repository import TelegramConfigRepository
from ..repositories.business_repository import BusinessRepository
from .utils import api_response

logger = logging.getLogger(__name__)

telegram_settings_bp = Blueprint('telegram_settings', __name__, url_prefix='/api/telegram')

config_repo = TelegramConfigRepository()
business_repo = BusinessRepository()


def _config_to_dict(config):
    return {
        'is_configured': True,
        'telegram_chat_id': config.telegram_chat_id,
        'current_processing_month': config.current_processing_month.isoformat() if config.current_processing_month else None,
        'auto_advance_day': config.auto_advance_day,
        'is_active': config.is_active,
    }


@telegram_settings_bp.route('/settings', methods=['GET'])
@token_required
def get_settings():
    """Get the Telegram bot configuration for the current business."""
    try:
        business_id = g.business_id
        if not business_id:
            return api_response(status_code=403, message="No business context", error="Forbidden")

        config = config_repo.get_by_business(business_id)
        if not config:
            return api_response(data={'is_configured': False})

        return api_response(data=_config_to_dict(config))
    except Exception as e:
        logger.exception("Failed to get Telegram settings")
        return api_response(status_code=500, message="Failed to get Telegram settings", error=str(e))


@telegram_settings_bp.route('/settings', methods=['PATCH'])
@token_required
def update_settings():
    """Update Telegram bot settings (processing_month, auto_advance_day)."""
    try:
        business_id = g.business_id
        if not business_id:
            return api_response(status_code=403, message="No business context", error="Forbidden")

        config = config_repo.get_by_business(business_id)
        if not config:
            return api_response(status_code=404, message="Telegram not configured for this business", error="Not Found")

        data = request.get_json() or {}
        updates = {}

        if 'current_processing_month' in data:
            try:
                updates['current_processing_month'] = date.fromisoformat(data['current_processing_month'])
            except (ValueError, TypeError):
                return api_response(status_code=400, message="Invalid current_processing_month format (expected YYYY-MM-DD)", error="Bad Request")

        if 'auto_advance_day' in data:
            val = data['auto_advance_day']
            if val is None:
                updates['auto_advance_day'] = None
            else:
                try:
                    val = int(val)
                    if not (1 <= val <= 28):
                        raise ValueError()
                    updates['auto_advance_day'] = val
                except (ValueError, TypeError):
                    return api_response(status_code=400, message="auto_advance_day must be an integer 1–28", error="Bad Request")

        if updates:
            config_repo.update(config.id, **updates)

        config = config_repo.get_by_business(business_id)
        return api_response(data=_config_to_dict(config))
    except Exception as e:
        logger.exception("Failed to update Telegram settings")
        return api_response(status_code=500, message="Failed to update Telegram settings", error=str(e))


@telegram_settings_bp.route('/admin/register-chat', methods=['POST'])
@token_required
def register_chat():
    """Register a Telegram chat_id for a business (APPLICATION_MANAGER only)."""
    try:
        current_user = g.current_user
        if current_user.role != 'APPLICATION_MANAGER':
            return api_response(status_code=403, message="Application manager access required", error="Forbidden")

        data = request.get_json() or {}
        business_id = data.get('business_id')
        telegram_chat_id = data.get('telegram_chat_id')

        if not business_id or telegram_chat_id is None:
            return api_response(status_code=400, message="business_id and telegram_chat_id are required", error="Bad Request")

        business = business_repo.get_by_id(business_id)
        if not business:
            return api_response(status_code=404, message="Business not found", error="Not Found")

        existing = config_repo.get_by_business(business_id)
        if existing:
            config_repo.update(existing.id, telegram_chat_id=int(telegram_chat_id), is_active=True)
            config = config_repo.get_by_business(business_id)
        else:
            today = date.today()
            current_month = date(today.year, today.month, 1)
            config = config_repo.create(
                business_id=business_id,
                telegram_chat_id=int(telegram_chat_id),
                current_processing_month=current_month,
                is_active=True,
            )

        return api_response(data=_config_to_dict(config), message="Chat registered successfully")
    except Exception as e:
        logger.exception("Failed to register Telegram chat")
        return api_response(status_code=500, message="Failed to register chat", error=str(e))
