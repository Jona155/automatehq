import logging
import os
import requests as http_requests
from datetime import date
from flask import Blueprint, request, g
from ..auth_utils import token_required
from ..repositories.telegram_repository import TelegramConfigRepository, TelegramIngestedFileRepository, TelegramPollingStateRepository
from ..repositories.business_repository import BusinessRepository
from .utils import api_response

logger = logging.getLogger(__name__)

telegram_settings_bp = Blueprint('telegram_settings', __name__, url_prefix='/api/telegram')

config_repo = TelegramConfigRepository()
business_repo = BusinessRepository()
ingested_file_repo = TelegramIngestedFileRepository()
polling_state_repo = TelegramPollingStateRepository()


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


def _admin_config_to_dict(config, business):
    return {
        'id': str(config.id),
        'business_id': str(config.business_id),
        'business_name': business.name,
        'business_code': business.code,
        'telegram_chat_id': config.telegram_chat_id,
        'current_processing_month': config.current_processing_month.isoformat() if config.current_processing_month else None,
        'auto_advance_day': config.auto_advance_day,
        'is_active': config.is_active,
        'created_at': config.created_at.isoformat() if config.created_at else None,
        'updated_at': config.updated_at.isoformat() if config.updated_at else None,
    }


@telegram_settings_bp.route('/admin/configs', methods=['GET'])
@token_required
def list_admin_configs():
    """List all Telegram configs with business info (APPLICATION_MANAGER only)."""
    try:
        current_user = g.current_user
        if current_user.role != 'APPLICATION_MANAGER':
            return api_response(status_code=403, message="Application manager access required", error="Forbidden")

        rows = config_repo.get_all_with_business()
        result = [_admin_config_to_dict(cfg, biz) for cfg, biz in rows]
        return api_response(data=result)
    except Exception as e:
        logger.exception("Failed to list Telegram configs")
        return api_response(status_code=500, message="Failed to list configs", error=str(e))


@telegram_settings_bp.route('/admin/config/<business_id>', methods=['GET'])
@token_required
def get_admin_config(business_id):
    """Get Telegram config for a specific business (APPLICATION_MANAGER only)."""
    try:
        current_user = g.current_user
        if current_user.role != 'APPLICATION_MANAGER':
            return api_response(status_code=403, message="Application manager access required", error="Forbidden")

        config = config_repo.get_by_business(business_id)
        if not config:
            return api_response(data=None)

        business = business_repo.get_by_id(business_id)
        if not business:
            return api_response(status_code=404, message="Business not found", error="Not Found")

        return api_response(data=_admin_config_to_dict(config, business))
    except Exception as e:
        logger.exception("Failed to get Telegram config")
        return api_response(status_code=500, message="Failed to get config", error=str(e))


@telegram_settings_bp.route('/admin/config/<business_id>', methods=['PATCH'])
@token_required
def update_admin_config(business_id):
    """Update Telegram config fields (APPLICATION_MANAGER only)."""
    try:
        current_user = g.current_user
        if current_user.role != 'APPLICATION_MANAGER':
            return api_response(status_code=403, message="Application manager access required", error="Forbidden")

        config = config_repo.get_by_business(business_id)
        if not config:
            return api_response(status_code=404, message="Telegram config not found for this business", error="Not Found")

        data = request.get_json() or {}
        updates = {}

        if 'telegram_chat_id' in data:
            try:
                updates['telegram_chat_id'] = int(data['telegram_chat_id'])
            except (ValueError, TypeError):
                return api_response(status_code=400, message="Invalid telegram_chat_id", error="Bad Request")

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

        if 'is_active' in data:
            updates['is_active'] = bool(data['is_active'])

        if updates:
            config_repo.update(config.id, **updates)

        config = config_repo.get_by_business(business_id)
        business = business_repo.get_by_id(business_id)
        return api_response(data=_admin_config_to_dict(config, business))
    except Exception as e:
        logger.exception("Failed to update Telegram config")
        return api_response(status_code=500, message="Failed to update config", error=str(e))


@telegram_settings_bp.route('/admin/config/<business_id>', methods=['DELETE'])
@token_required
def delete_admin_config(business_id):
    """Hard-delete a Telegram config (APPLICATION_MANAGER only)."""
    try:
        current_user = g.current_user
        if current_user.role != 'APPLICATION_MANAGER':
            return api_response(status_code=403, message="Application manager access required", error="Forbidden")

        config = config_repo.get_by_business(business_id)
        if not config:
            return api_response(status_code=404, message="Telegram config not found for this business", error="Not Found")

        config_repo.delete_by_id(config.id)
        return api_response(status_code=204, message="Config deleted")
    except Exception as e:
        logger.exception("Failed to delete Telegram config")
        return api_response(status_code=500, message="Failed to delete config", error=str(e))


@telegram_settings_bp.route('/admin/validate-chat/<business_id>', methods=['POST'])
@token_required
def validate_chat(business_id):
    """Validate Telegram bot access to a chat by calling getChat API (APPLICATION_MANAGER only)."""
    try:
        current_user = g.current_user
        if current_user.role != 'APPLICATION_MANAGER':
            return api_response(status_code=403, message="Application manager access required", error="Forbidden")

        config = config_repo.get_by_business(business_id)
        if not config:
            return api_response(status_code=404, message="Telegram not configured for this business", error="Not Found")

        bot_token = os.environ.get('TELEGRAM_BOT_TOKEN')
        if not bot_token:
            return api_response(status_code=500, message="TELEGRAM_BOT_TOKEN is not configured", error="Server Error")

        resp = http_requests.get(
            f'https://api.telegram.org/bot{bot_token}/getChat',
            params={'chat_id': config.telegram_chat_id},
            timeout=10,
        )
        data = resp.json()
        if data.get('ok'):
            result = data['result']
            return api_response(data={
                'valid': True,
                'chat_title': result.get('title'),
                'chat_type': result.get('type'),
            })
        return api_response(data={
            'valid': False,
            'error': data.get('description', 'Unknown error'),
        })
    except http_requests.Timeout:
        return api_response(data={'valid': False, 'error': 'Request timed out'})
    except Exception as e:
        logger.exception("Failed to validate Telegram chat")
        return api_response(status_code=500, message="Failed to validate chat", error=str(e))


@telegram_settings_bp.route('/admin/logs/<business_id>', methods=['GET'])
@token_required
def get_admin_logs(business_id):
    """Get paginated ingestion logs for a business (APPLICATION_MANAGER only)."""
    try:
        current_user = g.current_user
        if current_user.role != 'APPLICATION_MANAGER':
            return api_response(status_code=403, message="Application manager access required", error="Forbidden")

        config = config_repo.get_by_business(business_id)
        if not config:
            return api_response(data={'items': [], 'total': 0, 'limit': 20, 'offset': 0})

        try:
            limit = max(1, min(100, int(request.args.get('limit', 20))))
            offset = max(0, int(request.args.get('offset', 0)))
        except (ValueError, TypeError):
            limit, offset = 20, 0

        items, total = ingested_file_repo.get_by_chat_id_paginated(config.telegram_chat_id, limit, offset)

        def _log_to_dict(item):
            return {
                'id': str(item.id),
                'file_unique_id': item.file_unique_id,
                'status': item.status,
                'error_message': item.error_message,
                'telegram_username': item.telegram_username,
                'telegram_user_id': item.telegram_user_id,
                'message_timestamp': item.message_timestamp.isoformat() if item.message_timestamp else None,
                'processed_at': item.processed_at.isoformat() if item.processed_at else None,
                'work_card_id': str(item.work_card_id) if item.work_card_id else None,
            }

        return api_response(data={
            'items': [_log_to_dict(i) for i in items],
            'total': total,
            'limit': limit,
            'offset': offset,
        })
    except Exception as e:
        logger.exception("Failed to get Telegram logs")
        return api_response(status_code=500, message="Failed to get logs", error=str(e))


@telegram_settings_bp.route('/admin/peek-messages/<business_id>', methods=['POST'])
@token_required
def peek_messages(business_id):
    """
    Peek at unprocessed Telegram messages for this business without advancing the worker offset.
    Calls getUpdates from the current stored offset, filters by business chat_id, returns metadata only.
    Read-only — does not download files, create work cards, or modify any state.
    (APPLICATION_MANAGER only)
    """
    try:
        current_user = g.current_user
        if current_user.role != 'APPLICATION_MANAGER':
            return api_response(status_code=403, message="Application manager access required", error="Forbidden")

        config = config_repo.get_by_business(business_id)
        if not config:
            return api_response(status_code=404, message="Telegram not configured for this business", error="Not Found")

        bot_token = os.environ.get('TELEGRAM_BOT_TOKEN')
        if not bot_token:
            return api_response(status_code=500, message="TELEGRAM_BOT_TOKEN is not configured", error="Server Error")

        # Get the current polling offset — read only, do not modify it
        state = polling_state_repo.get_or_create()
        current_offset = state.last_offset

        resp = http_requests.get(
            f'https://api.telegram.org/bot{bot_token}/getUpdates',
            params={'offset': current_offset, 'limit': 20, 'timeout': 0},
            timeout=15,
        )
        resp.raise_for_status()
        data = resp.json()

        if not data.get('ok'):
            return api_response(data={
                'messages': [],
                'current_offset': current_offset,
                'error': data.get('description', 'getUpdates returned not ok'),
            })

        updates = data.get('result', [])
        messages = []
        for update in updates:
            message = update.get('message') or update.get('channel_post')
            if not message:
                continue

            chat_id = message.get('chat', {}).get('id')
            if chat_id != config.telegram_chat_id:
                continue

            user = message.get('from') or {}
            has_photo = 'photo' in message
            message_date = message.get('date')

            messages.append({
                'update_id': update.get('update_id'),
                'message_id': message.get('message_id'),
                'has_photo': has_photo,
                'telegram_username': user.get('username'),
                'telegram_user_id': user.get('id'),
                'message_timestamp': message_date,
                'caption': message.get('caption'),
                'text': message.get('text') if not has_photo else None,
            })

        return api_response(data={
            'messages': messages,
            'current_offset': current_offset,
            'total_pending_bot_updates': len(updates),
        })
    except http_requests.Timeout:
        return api_response(status_code=504, message="Telegram API timed out", error="Timeout")
    except Exception as e:
        logger.exception("Failed to peek Telegram messages")
        return api_response(status_code=500, message="Failed to fetch messages", error=str(e))


@telegram_settings_bp.route('/admin/diagnostics/<business_id>', methods=['POST'])
@token_required
def run_diagnostics(business_id):
    """
    Full Telegram diagnostics for a business.
    Returns: bot identity, stored offset, raw updates (all types, all chats), and a diagnosis.
    Read-only — never modifies offset or any state.
    (APPLICATION_MANAGER only)
    """
    try:
        current_user = g.current_user
        if current_user.role != 'APPLICATION_MANAGER':
            return api_response(status_code=403, message="Application manager access required", error="Forbidden")

        config = config_repo.get_by_business(business_id)
        if not config:
            return api_response(status_code=404, message="Telegram not configured for this business", error="Not Found")

        bot_token = os.environ.get('TELEGRAM_BOT_TOKEN')
        if not bot_token:
            return api_response(status_code=500, message="TELEGRAM_BOT_TOKEN is not configured", error="Server Error")

        base = f'https://api.telegram.org/bot{bot_token}'
        target_chat_id = config.telegram_chat_id

        # 1. Bot identity
        bot_info = None
        try:
            me_resp = http_requests.get(f'{base}/getMe', timeout=10)
            me_data = me_resp.json()
            if me_data.get('ok'):
                r = me_data['result']
                bot_info = {
                    'id': r.get('id'),
                    'username': r.get('username'),
                    'first_name': r.get('first_name'),
                }
        except Exception:
            pass

        # 2. Stored offset
        state = polling_state_repo.get_or_create()
        stored_offset = state.last_offset

        # 3. Raw getUpdates from stored offset — all update types, no filtering
        updates_raw = []
        get_updates_error = None
        try:
            up_resp = http_requests.get(
                f'{base}/getUpdates',
                params={'offset': stored_offset, 'limit': 20, 'timeout': 0},
                timeout=15,
            )
            up_data = up_resp.json()
            if up_data.get('ok'):
                updates_raw = up_data.get('result', [])
            else:
                get_updates_error = up_data.get('description', 'getUpdates not ok')
        except http_requests.Timeout:
            get_updates_error = 'getUpdates timed out'
        except Exception as ex:
            get_updates_error = str(ex)

        # 4. Classify each update
        classified = []
        other_chat_ids = set()
        photos_from_target = 0
        any_from_target = 0

        for upd in updates_raw:
            update_id = upd.get('update_id')
            msg = upd.get('message') or upd.get('channel_post') or upd.get('edited_message')
            update_type = next((k for k in upd if k != 'update_id'), 'unknown')

            chat_id = None
            msg_type = None
            username = None
            timestamp = None

            if msg:
                chat_id = msg.get('chat', {}).get('id')
                username = (msg.get('from') or {}).get('username')
                timestamp = msg.get('date')
                if 'photo' in msg:
                    msg_type = 'photo'
                elif 'document' in msg:
                    msg_type = 'document'
                elif 'text' in msg:
                    msg_type = 'text'
                else:
                    msg_type = 'other'

            is_target = (chat_id == target_chat_id)
            if is_target:
                any_from_target += 1
                if msg_type == 'photo':
                    photos_from_target += 1
            elif chat_id is not None:
                other_chat_ids.add(chat_id)

            classified.append({
                'update_id': update_id,
                'update_type': update_type,
                'chat_id': chat_id,
                'is_target_chat': is_target,
                'message_type': msg_type,
                'username': username,
                'timestamp': timestamp,
            })

        # 5. Diagnosis
        total = len(updates_raw)
        if get_updates_error:
            diagnosis = 'api_error'
            diagnosis_detail = get_updates_error
        elif total == 0:
            diagnosis = 'no_updates'
            diagnosis_detail = (
                'הבוט לא קיבל אף הודעה. הסיבה הנפוצה ביותר: Privacy Mode מופעל. '
                'עבור ל-@BotFather ← /mybots ← הבוט שלך ← Bot Settings ← Group Privacy ← Turn off. '
                'לאחר מכן הוצא את הבוט מהקבוצה והוסף אותו מחדש.'
            )
        elif any_from_target == 0 and other_chat_ids:
            diagnosis = 'chat_id_mismatch'
            diagnosis_detail = (
                f'הבוט מקבל הודעות מ-{len(other_chat_ids)} צ\'אטים אחרים, אך לא מהצ\'אט המוגדר ({target_chat_id}). '
                f'בדוק שה-Chat ID נכון. צ\'אטים שמתקבלים: {list(other_chat_ids)[:5]}'
            )
        elif any_from_target > 0 and photos_from_target == 0:
            diagnosis = 'no_photos'
            diagnosis_detail = (
                f'הבוט מקבל הודעות מהצ\'אט הנכון ({target_chat_id}), '
                'אך לא תמונות. ייתכן ש-Privacy Mode חלקי מופעל (הבוט מקבל פקודות אך לא תמונות). '
                'ודא שלבוט יש הרשאות Admin בקבוצה, או כבה Privacy Mode לחלוטין.'
            )
        else:
            diagnosis = 'ok'
            diagnosis_detail = f'{photos_from_target} תמונות ממתינות לעיבוד מהצ\'אט הנכון. הפולר יעבד אותן בסבב הבא.'

        return api_response(data={
            'bot': bot_info,
            'stored_offset': stored_offset,
            'target_chat_id': target_chat_id,
            'updates': classified,
            'summary': {
                'total_updates': total,
                'from_target_chat': any_from_target,
                'photos_from_target_chat': photos_from_target,
                'other_chat_ids': list(other_chat_ids),
            },
            'diagnosis': diagnosis,
            'diagnosis_detail': diagnosis_detail,
            'get_updates_error': get_updates_error,
        })
    except Exception as e:
        logger.exception("Failed to run Telegram diagnostics")
        return api_response(status_code=500, message="Failed to run diagnostics", error=str(e))
