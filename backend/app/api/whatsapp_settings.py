import logging
from datetime import date

from flask import Blueprint, request, g

from ..auth_utils import token_required
from ..repositories.whatsapp_repository import WhatsAppGroupConfigRepository
from ..services.whatsapp_listener_client import (
    WhatsAppAuthError,
    WhatsAppBadRequestError,
    WhatsAppListenerClient,
    WhatsAppListenerError,
    WhatsAppNotConnectedError,
)
from .utils import api_response

logger = logging.getLogger(__name__)

whatsapp_settings_bp = Blueprint('whatsapp_settings', __name__, url_prefix='/api/whatsapp')

config_repo = WhatsAppGroupConfigRepository()


def _get_client():
    client = WhatsAppListenerClient.from_env()
    if client is None:
        return None, api_response(
            status_code=503,
            message="WhatsApp listener not configured",
            error="WA_LISTENER_URL is not set",
        )
    return client, None


def _config_to_dict(config):
    if config is None:
        return None
    return {
        'chat_id': config.chat_id,
        'chat_name': config.chat_name,
        'current_processing_month': config.current_processing_month.isoformat() if config.current_processing_month else None,
        'auto_advance_day': config.auto_advance_day,
        'last_seen_timestamp': config.last_seen_timestamp.isoformat() if config.last_seen_timestamp else None,
        'is_active': config.is_active,
    }


@whatsapp_settings_bp.route('/status', methods=['GET'])
@token_required
def get_status():
    """Proxy to listener /api/status. Returns {connected, hasAuth}."""
    client, err = _get_client()
    if err:
        return err
    try:
        return api_response(data=client.status())
    except WhatsAppListenerError as e:
        logger.warning(f"WhatsApp listener unreachable: {e}")
        return api_response(status_code=503, message="WhatsApp listener unreachable", error=str(e))


@whatsapp_settings_bp.route('/qr', methods=['GET'])
@token_required
def get_qr():
    """Proxy to listener /api/qr. Returns {qrDataUrl: string | null}."""
    client, err = _get_client()
    if err:
        return err
    try:
        return api_response(data=client.qr())
    except WhatsAppListenerError as e:
        logger.warning(f"WhatsApp listener unreachable: {e}")
        return api_response(status_code=503, message="WhatsApp listener unreachable", error=str(e))


@whatsapp_settings_bp.route('/config', methods=['GET'])
@token_required
def get_config():
    """Return the current business's WhatsApp group config, or null."""
    business_id = g.business_id
    if not business_id:
        return api_response(status_code=403, message="No business context", error="Forbidden")

    config = config_repo.get_by_business(business_id)
    return api_response(data=_config_to_dict(config))


@whatsapp_settings_bp.route('/groups', methods=['GET'])
@token_required
def list_groups():
    """
    List WhatsApp groups from the listener. Each group carries an is_linked flag
    (true if any business has already linked it — protects against collisions).
    """
    business_id = g.business_id
    if not business_id:
        return api_response(status_code=403, message="No business context", error="Forbidden")

    client, err = _get_client()
    if err:
        return err

    try:
        groups = client.list_groups()
    except WhatsAppNotConnectedError as e:
        return api_response(status_code=503, message="WhatsApp listener not connected", error=str(e))
    except WhatsAppListenerError as e:
        logger.warning(f"list_groups failed: {e}")
        return api_response(status_code=502, message="Failed to fetch groups from listener", error=str(e))

    # Which chat_ids are already linked to this business — highlight in UI.
    my_config = config_repo.get_by_business(business_id)
    my_chat_id = my_config.chat_id if my_config else None

    result = [
        {
            'chat_id': chat_id,
            'chat_name': name or chat_id,  # fallback for empty group names
            'is_linked_to_me': chat_id == my_chat_id,
        }
        for chat_id, name in groups.items()
    ]
    # Stable ordering: linked-to-me first, then alphabetical
    result.sort(key=lambda g: (not g['is_linked_to_me'], (g['chat_name'] or '').lower()))
    return api_response(data=result)


@whatsapp_settings_bp.route('/link', methods=['POST'])
@token_required
def create_link():
    """Link a WhatsApp group to the current business. Registers with the listener, then persists the config."""
    business_id = g.business_id
    if not business_id:
        return api_response(status_code=403, message="No business context", error="Forbidden")

    data = request.get_json() or {}
    chat_id = data.get('chat_id')
    if not chat_id:
        return api_response(status_code=400, message="chat_id is required", error="Bad Request")

    # Guard: business already linked
    if config_repo.get_by_business(business_id):
        return api_response(
            status_code=409,
            message="This business already has a WhatsApp group linked — unlink it first",
            error="Conflict",
        )
    # Guard: chat_id already linked to another business
    existing_for_chat = config_repo.get_by_chat_id(chat_id)
    if existing_for_chat:
        return api_response(
            status_code=409,
            message="This WhatsApp group is already linked to another business",
            error="Conflict",
        )

    client, err = _get_client()
    if err:
        return err

    # Register with the listener FIRST — if that fails, don't persist.
    try:
        client.register(chat_id)
    except WhatsAppNotConnectedError as e:
        return api_response(status_code=503, message="WhatsApp listener not connected", error=str(e))
    except WhatsAppAuthError as e:
        logger.error(f"Listener auth failure: {e}")
        return api_response(status_code=500, message="WhatsApp listener auth misconfigured", error="Server Error")
    except (WhatsAppBadRequestError, WhatsAppListenerError) as e:
        logger.warning(f"listener.register failed for chat_id={chat_id}: {e}")
        return api_response(status_code=502, message="Failed to register group with listener", error=str(e))

    # Best-effort lookup of the group name.
    chat_name = None
    try:
        groups = client.list_groups()
        chat_name = groups.get(chat_id) or None
    except WhatsAppListenerError:
        pass

    today = date.today()
    current_month = date(today.year, today.month, 1)
    config = config_repo.create(
        business_id=business_id,
        chat_id=chat_id,
        chat_name=chat_name,
        current_processing_month=current_month,
        is_active=True,
    )
    return api_response(data=_config_to_dict(config), message="WhatsApp group linked successfully")


@whatsapp_settings_bp.route('/link', methods=['DELETE'])
@token_required
def delete_link():
    """Unlink the current business's WhatsApp group. Unregisters from the listener (best-effort), then deletes the config."""
    business_id = g.business_id
    if not business_id:
        return api_response(status_code=403, message="No business context", error="Forbidden")

    config = config_repo.get_by_business(business_id)
    if not config:
        return api_response(status_code=404, message="No WhatsApp group linked", error="Not Found")

    chat_id = config.chat_id

    client = WhatsAppListenerClient.from_env()
    if client is not None:
        try:
            client.unregister(chat_id)
        except WhatsAppListenerError as e:
            logger.warning(f"listener.unregister failed for chat_id={chat_id} (deleting local config anyway): {e}")

    config_repo.delete_by_business(business_id)
    return api_response(message="WhatsApp group unlinked")
