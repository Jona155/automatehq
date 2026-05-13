"""
WhatsApp listener poller — runs as a background daemon thread inside the worker process.

Polls the Node WhatsApp Listener over HTTP for each configured site↔group link,
decodes base64 image payloads, and ingests them into the same extraction pipeline
used by portal/Telegram uploads.

Environment variables:
    WA_LISTENER_URL               — required; polling is disabled if missing
    WA_LISTENER_API_KEY           — defaults to local-test-key-change-me
    WA_LISTENER_POLL_SECONDS      — default 10
    WA_LISTENER_FETCH_LIMIT       — default 50
"""
import base64
import hashlib
import logging
import os
import re
import sys
import time
from datetime import datetime
from typing import Optional

# Add backend to path (same pattern as run.py)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from app.repositories.whatsapp_repository import (
    WhatsAppGroupConfigRepository,
    WhatsAppIngestedMessageRepository,
)
from app.repositories.work_card_repository import WorkCardRepository
from app.repositories.work_card_file_repository import WorkCardFileRepository
from app.repositories.work_card_extraction_repository import WorkCardExtractionRepository
from app.services.whatsapp_listener_client import (
    WhatsAppListenerClient,
    WhatsAppListenerError,
    WhatsAppNotConnectedError,
)

logger = logging.getLogger('whatsapp_poller')

POLL_SECONDS = int(os.environ.get('WA_LISTENER_POLL_SECONDS', '10'))
FETCH_LIMIT = int(os.environ.get('WA_LISTENER_FETCH_LIMIT', '50'))

_DATA_URL_RE = re.compile(r'^data:(image/[a-zA-Z0-9+.-]+);base64,(.+)$')

INGEST_ACK_MESSAGE = '✅ קיבלנו! מעבד את התמונה...'
DUPLICATE_ACK_MESSAGE = '⚠️ תמונה זו כבר הועלתה החודש'


def _decode_media(data_url: str) -> Optional[tuple[bytes, str]]:
    """Return (image_bytes, mime_type) or None if the data URL is malformed."""
    match = _DATA_URL_RE.match(data_url or '')
    if not match:
        return None
    mime_type, b64 = match.groups()
    try:
        return base64.b64decode(b64), mime_type
    except Exception:
        return None


def _parse_ts(ts: Optional[str]) -> Optional[datetime]:
    if not ts:
        return None
    # The listener emits ISO 8601 with a trailing Z. Python 3.9's fromisoformat
    # chokes on Z, so normalize it.
    normalized = ts.replace('Z', '+00:00') if ts.endswith('Z') else ts
    try:
        return datetime.fromisoformat(normalized)
    except ValueError:
        return None


def _ingest_image(
    image_bytes: bytes,
    mime_type: str,
    message_id: str,
    caption: Optional[str],
    config,
) -> tuple[str, bool]:
    """
    Create WorkCard + WorkCardFile + WorkCardExtraction(PENDING).
    Mirrors worker/telegram_poller.py::_ingest_image — one group per business,
    site assignment happens downstream via employee matching in run.py.

    Returns (work_card_id, is_duplicate).
    """
    work_card_repo = WorkCardRepository()
    file_repo = WorkCardFileRepository()
    extraction_repo = WorkCardExtractionRepository()

    file_hash = hashlib.sha256(image_bytes).hexdigest()
    existing = work_card_repo.find_by_hash(
        config.business_id, config.current_processing_month, file_hash
    )
    if existing:
        logger.info('[WhatsApp] Skipping duplicate image (hash=%s, existing_card=%s)', file_hash[:8], existing.id)
        return str(existing.id), True

    ext = mime_type.split('/')[-1].split('+')[0] or 'jpg'
    filename = f'whatsapp_{message_id}.{ext}'

    work_card = work_card_repo.create(
        business_id=config.business_id,
        site_id=None,
        employee_id=None,
        processing_month=config.current_processing_month,
        source='WHATSAPP',
        uploaded_by_user_id=None,
        original_filename=filename,
        mime_type=mime_type,
        file_size_bytes=len(image_bytes),
        review_status='NEEDS_ASSIGNMENT',
        telegram_caption=caption,  # reused column; see docs/whatsapp_integration_phase2.md
        sha256_hash=file_hash,
    )

    file_repo.create(
        work_card_id=work_card.id,
        content_type=mime_type,
        file_name=filename,
        image_bytes=image_bytes,
    )

    extraction_repo.create(
        work_card_id=work_card.id,
        status='PENDING',
    )

    return str(work_card.id), False


def _process_config(client: WhatsAppListenerClient, config) -> None:
    """Poll one site↔group config once and ingest any new image messages."""
    config_repo = WhatsAppGroupConfigRepository()
    ingested_repo = WhatsAppIngestedMessageRepository()

    since = config.last_seen_timestamp.isoformat() if config.last_seen_timestamp else None
    try:
        messages = client.fetch_messages(chat_id=config.chat_id, since=since, limit=FETCH_LIMIT)
    except WhatsAppNotConnectedError as e:
        logger.warning(f"[WhatsApp] listener not connected while polling {config.chat_id}: {e}")
        return
    except WhatsAppListenerError as e:
        logger.warning(f"[WhatsApp] fetch failed for {config.chat_id}: {e}")
        return

    # Sort chronologically so per-message cursor advance is safe on crash recovery.
    messages.sort(key=lambda m: m.get('timestamp') or '')

    ingested = 0
    skipped = 0
    errors = 0

    # Auto-advance the processing month if due (mirrors Telegram).
    try:
        if config_repo.advance_month_if_due(config):
            config = config_repo.get_by_business(config.business_id)
            logger.info(
                f"[WhatsApp] auto-advanced processing month to {config.current_processing_month} "
                f"for chat {config.chat_id}"
            )
    except Exception as e:
        logger.warning(f"[WhatsApp] advance_month_if_due failed: {e}")

    for m in messages:
        message_id = m.get('messageId')
        if not message_id:
            continue

        ts = _parse_ts(m.get('timestamp'))
        record_kwargs = dict(
            message_id=message_id,
            chat_id=config.chat_id,
            chat_name=m.get('chatName'),
            sender=m.get('sender'),
            push_name=m.get('pushName'),
            message_timestamp=ts,
            caption=m.get('text'),
        )

        if ingested_repo.exists_by_message_id(message_id):
            logger.debug(f"[WhatsApp] already-seen message_id={message_id}")
            if ts:
                config_repo.update_cursor(config.id, ts)
            continue

        media_type = m.get('mediaType')
        if media_type != 'image':
            try:
                ingested_repo.create(
                    **record_kwargs,
                    status='SKIPPED',
                    error_message=f'mediaType={media_type}',
                )
            except Exception as e:
                logger.warning(f"[WhatsApp] failed to record skipped message {message_id}: {e}")
            skipped += 1
            if ts:
                config_repo.update_cursor(config.id, ts)
            continue

        media_data = m.get('mediaData')
        decoded = _decode_media(media_data) if isinstance(media_data, str) else None
        if decoded is None:
            try:
                ingested_repo.create(
                    **record_kwargs,
                    status='ERROR',
                    error_message='mediaData missing or not a recognizable data URL',
                )
            except Exception as e:
                logger.warning(f"[WhatsApp] failed to record error for {message_id}: {e}")
            errors += 1
            if ts:
                config_repo.update_cursor(config.id, ts)
            continue

        image_bytes, mime_type = decoded
        try:
            work_card_id, is_duplicate = _ingest_image(
                image_bytes=image_bytes,
                mime_type=mime_type,
                message_id=message_id,
                caption=m.get('text'),
                config=config,
            )
            ingested_repo.create(
                **record_kwargs,
                work_card_id=work_card_id,
                status='INGESTED',
            )
            ingested += 1
            logger.info(
                f"[WhatsApp] ingested message_id={message_id} → work_card {work_card_id} "
                f"(caption={(m.get('text') or '')[:40]!r}, duplicate={is_duplicate})"
            )
            ack_text = DUPLICATE_ACK_MESSAGE if is_duplicate else INGEST_ACK_MESSAGE
            try:
                client.send(chat_id=config.chat_id, text=ack_text)
                logger.info(
                    f"[WhatsApp] ack sent to {config.chat_id} for work_card {work_card_id}"
                )
            except Exception as send_err:
                logger.warning(
                    f"[WhatsApp] ack send failed for {config.chat_id} "
                    f"(work_card {work_card_id}): {type(send_err).__name__}: {send_err}"
                )
        except Exception as e:
            logger.error(f"[WhatsApp] ingest failed for {message_id}: {e}")
            errors += 1
            try:
                ingested_repo.create(**record_kwargs, status='ERROR', error_message=str(e))
            except Exception as record_err:
                logger.error(f"[WhatsApp] also failed to record error: {record_err}")

        if ts:
            config_repo.update_cursor(config.id, ts)

    if messages:
        logger.info(
            f"[WhatsApp] poll chat={config.chat_id}: {len(messages)} messages, "
            f"{ingested} ingested, {skipped} skipped, {errors} errors"
        )


def poll_once(flask_app) -> None:
    """Run a single polling cycle inside the given Flask app context."""
    client = WhatsAppListenerClient.from_env()
    if client is None:
        logger.warning("[WhatsApp] WA_LISTENER_URL not set — skipping poll cycle")
        return

    with flask_app.app_context():
        config_repo = WhatsAppGroupConfigRepository()
        configs = config_repo.list_all_active()
        if not configs:
            return
        for config in configs:
            try:
                _process_config(client, config)
            except Exception as e:
                logger.error(f"[WhatsApp] unexpected error processing chat {config.chat_id}: {e}")


def run_whatsapp_polling_loop(flask_app) -> None:
    """Main polling loop — runs forever as a daemon thread."""
    logger.info(f"[WhatsApp] polling thread started (every {POLL_SECONDS}s)")
    while True:
        try:
            poll_once(flask_app)
        except Exception as e:
            logger.error(f"[WhatsApp] poll cycle error: {e}")
        time.sleep(POLL_SECONDS)
