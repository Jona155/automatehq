"""
Telegram bot poller — runs as a background daemon thread inside the worker process.

Polls Telegram getUpdates, downloads images sent to the bot, and ingests them
into the same extraction pipeline used by portal uploads.

Environment variables:
    TELEGRAM_BOT_TOKEN              — required; polling is disabled if missing
    TELEGRAM_POLLING_INTERVAL_SECONDS — default 120
    TELEGRAM_BATCH_SIZE             — default 20
"""
import os
import sys
import time
import logging
from datetime import datetime, timezone
from typing import Optional

import requests

# Add backend to path (same pattern as run.py)
sys.path.insert(0, os.path.join(os.path.dirname(__file__), '..', 'backend'))

from app.repositories.telegram_repository import (
    TelegramConfigRepository,
    TelegramIngestedFileRepository,
    TelegramPollingStateRepository,
)
from app.repositories.work_card_repository import WorkCardRepository
from app.repositories.work_card_file_repository import WorkCardFileRepository
from app.repositories.work_card_extraction_repository import WorkCardExtractionRepository

logger = logging.getLogger('telegram_poller')

TELEGRAM_BOT_TOKEN = os.environ.get('TELEGRAM_BOT_TOKEN', '')
POLLING_INTERVAL_SECONDS = int(os.environ.get('TELEGRAM_POLLING_INTERVAL_SECONDS', '120'))
BATCH_SIZE = int(os.environ.get('TELEGRAM_BATCH_SIZE', '20'))

TELEGRAM_API_BASE = f'https://api.telegram.org/bot{TELEGRAM_BOT_TOKEN}'


def _api_url(method: str) -> str:
    return f'{TELEGRAM_API_BASE}/{method}'


def _get_updates(offset: int) -> list:
    try:
        resp = requests.get(
            _api_url('getUpdates'),
            params={'offset': offset, 'limit': BATCH_SIZE, 'timeout': 0},
            timeout=30,
        )
        resp.raise_for_status()
        data = resp.json()
        if data.get('ok'):
            return data.get('result', [])
        logger.warning(f"[Telegram] getUpdates not ok: {data}")
        return []
    except Exception as e:
        logger.error(f"[Telegram] getUpdates error: {e}")
        return []


def _get_file_path(file_id: str) -> Optional[str]:
    try:
        resp = requests.get(_api_url('getFile'), params={'file_id': file_id}, timeout=15)
        resp.raise_for_status()
        data = resp.json()
        if data.get('ok'):
            return data['result']['file_path']
        return None
    except Exception as e:
        logger.error(f"[Telegram] getFile error for {file_id}: {e}")
        return None


def _download_file(file_path: str) -> Optional[bytes]:
    try:
        url = f'https://api.telegram.org/file/bot{TELEGRAM_BOT_TOKEN}/{file_path}'
        resp = requests.get(url, timeout=60)
        resp.raise_for_status()
        return resp.content
    except Exception as e:
        logger.error(f"[Telegram] Download error for {file_path}: {e}")
        return None


def _send_reply(chat_id: int, message_id: int, text: str) -> None:
    try:
        requests.post(
            _api_url('sendMessage'),
            json={'chat_id': chat_id, 'reply_to_message_id': message_id, 'text': text},
            timeout=10,
        )
    except Exception as e:
        logger.warning(f"[Telegram] Failed to send reply: {e}")


def _ingest_image(image_bytes: bytes, file_unique_id: str, config, app_context) -> str:
    """
    Create WorkCard + WorkCardFile + WorkCardExtraction(PENDING).
    Returns the work_card_id as a string.
    """
    work_card_repo = WorkCardRepository()
    file_repo = WorkCardFileRepository()
    extraction_repo = WorkCardExtractionRepository()

    work_card = work_card_repo.create(
        business_id=config.business_id,
        site_id=None,
        employee_id=None,
        processing_month=config.current_processing_month,
        source='TELEGRAM',
        uploaded_by_user_id=None,
        original_filename=f'telegram_{file_unique_id}.jpg',
        mime_type='image/jpeg',
        file_size_bytes=len(image_bytes),
        review_status='NEEDS_ASSIGNMENT',
    )

    file_repo.create(
        work_card_id=work_card.id,
        content_type='image/jpeg',
        file_name=f'telegram_{file_unique_id}.jpg',
        image_bytes=image_bytes,
    )

    extraction_repo.create(
        work_card_id=work_card.id,
        status='PENDING',
    )

    return str(work_card.id)


def poll_once(flask_app) -> None:
    """Run a single polling cycle inside the given Flask app context."""
    state_repo = TelegramPollingStateRepository()
    config_repo = TelegramConfigRepository()
    ingested_repo = TelegramIngestedFileRepository()

    with flask_app.app_context():
        state = state_repo.get_or_create()
        offset = state.last_offset

        updates = _get_updates(offset)
        if not updates:
            return

        total = len(updates)
        photos = 0
        ingested = 0
        skipped = 0
        errors = 0
        max_update_id = offset - 1

        for update in updates:
            update_id = update.get('update_id', 0)
            max_update_id = max(max_update_id, update_id)

            message = update.get('message') or update.get('channel_post')
            if not message or 'photo' not in message:
                continue

            photos += 1

            photo_list = message['photo']
            best_photo = photo_list[-1]  # highest resolution
            file_unique_id = best_photo.get('file_unique_id', '')
            file_id = best_photo.get('file_id', '')
            chat_id = message.get('chat', {}).get('id')
            message_id = message.get('message_id')
            user = message.get('from') or {}
            telegram_user_id = user.get('id')
            telegram_username = user.get('username')
            message_date = message.get('date')
            message_timestamp = (
                datetime.fromtimestamp(message_date, tz=timezone.utc) if message_date else None
            )

            ingested_record_kwargs = dict(
                file_unique_id=file_unique_id,
                telegram_update_id=update_id,
                telegram_user_id=telegram_user_id,
                telegram_username=telegram_username,
                telegram_chat_id=chat_id,
                message_timestamp=message_timestamp,
            )

            # Dedup check
            if ingested_repo.exists_by_file_unique_id(file_unique_id):
                logger.debug(f"[Telegram] Skipping duplicate file_unique_id={file_unique_id}")
                skipped += 1
                continue

            # Config lookup
            config = config_repo.get_by_chat_id(chat_id) if chat_id else None
            if not config or not config.is_active:
                logger.warning(f"[Telegram] No active config for chat_id={chat_id}, skipping")
                skipped += 1
                ingested_repo.create(**ingested_record_kwargs, status='SKIPPED', error_message='No config for chat_id')
                continue

            # Auto-advance month if due
            try:
                advanced = config_repo.advance_month_if_due(config)
                if advanced:
                    config = config_repo.get_by_chat_id(chat_id)
                    logger.info(f"[Telegram] Auto-advanced processing month to {config.current_processing_month} for business {config.business_id}")
            except Exception as e:
                logger.warning(f"[Telegram] Failed to check auto-advance: {e}")

            try:
                # Download image
                file_path = _get_file_path(file_id)
                if not file_path:
                    raise RuntimeError(f"Could not get file_path for file_id={file_id}")

                image_bytes = _download_file(file_path)
                if not image_bytes:
                    raise RuntimeError(f"Could not download file_path={file_path}")

                # Ingest
                work_card_id = _ingest_image(image_bytes, file_unique_id, config, flask_app)

                ingested_repo.create(
                    **ingested_record_kwargs,
                    work_card_id=work_card_id,
                    status='INGESTED',
                )
                ingested += 1

                # Send acknowledgement
                if chat_id and message_id:
                    _send_reply(chat_id, message_id, '\u2713 Work card received')

            except Exception as e:
                logger.error(f"[Telegram] Failed to ingest update_id={update_id}: {e}")
                errors += 1
                try:
                    ingested_repo.create(**ingested_record_kwargs, status='ERROR', error_message=str(e))
                except Exception as record_err:
                    logger.error(f"[Telegram] Failed to record error: {record_err}")

        new_offset = max_update_id + 1
        if new_offset > offset:
            state_repo.set_offset(new_offset)
            logger.info(f"[Telegram] Offset advanced to {new_offset}")

        logger.info(
            f"[Telegram] Poll: {total} updates, {photos} photos, "
            f"{ingested} ingested, {skipped} skipped, {errors} errors"
        )


def run_telegram_polling_loop(flask_app) -> None:
    """Main polling loop — runs forever as a daemon thread."""
    logger.info("[Telegram] Polling thread started")
    while True:
        try:
            poll_once(flask_app)
        except Exception as e:
            logger.error(f"[Telegram] Poll cycle error: {e}")
        time.sleep(POLLING_INTERVAL_SECONDS)
