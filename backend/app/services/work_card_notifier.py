"""
'New card arrived' WhatsApp notifications.

When a business has enabled new-card notifications and configured a day-of-month
window, any work card uploaded within that window triggers a WhatsApp DM (the card
image + a Hebrew caption with context) to each configured destination platform user.

Invoked best-effort from the worker's extraction pipeline (worker/run.py::process_job)
— the universal funnel every uploaded card image passes through exactly once. Any
failure here is logged and swallowed so extraction is never affected.
"""
from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from zoneinfo import ZoneInfo

from ..repositories.whatsapp_repository import WhatsAppNotificationSettingsRepository
from ..repositories.user_repository import UserRepository
from ..repositories.work_card_file_repository import WorkCardFileRepository
from ..repositories.site_repository import SiteRepository
from ..services.whatsapp_listener_client import (
    WhatsAppListenerClient,
    WhatsAppListenerError,
)
from ..utils import format_whatsapp_chat_id, utc_now

logger = logging.getLogger(__name__)

# Day-of-month is evaluated in the business's local timezone so a window like
# "3rd–7th" lines up with the calendar the user sees, not UTC.
_LOCAL_TZ = ZoneInfo('Asia/Jerusalem')

# Hebrew month names for a friendly caption.
_HE_MONTHS = {
    1: 'ינואר', 2: 'פברואר', 3: 'מרץ', 4: 'אפריל', 5: 'מאי', 6: 'יוני',
    7: 'יולי', 8: 'אוגוסט', 9: 'ספטמבר', 10: 'אוקטובר', 11: 'נובמבר', 12: 'דצמבר',
}

_IMAGE_EXT = {
    'image/jpeg': 'jpg', 'image/jpg': 'jpg', 'image/png': 'png',
    'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf',
}


def _upload_day_of_month(created_at: datetime) -> int:
    """Day-of-month of an upload, evaluated in the business-local timezone."""
    if created_at.tzinfo is None:
        created_at = created_at.replace(tzinfo=timezone.utc)
    return created_at.astimezone(_LOCAL_TZ).day


def _in_window(day: int, start_day: int, end_day: int) -> bool:
    """Inclusive day-of-month window. Supports wrap-around (e.g. 28→3)."""
    if start_day <= end_day:
        return start_day <= day <= end_day
    return day >= start_day or day <= end_day


def _build_caption(work_card) -> str:
    lines = [
        '📄 כרטיס עבודה חדש התקבל!',
        '',
        'כרטיס זה התקבל לאחר תקופת העיבוד והבדיקה של הכרטיסים לצורך חישוב השכר '
        '(בהתאם להגדרות במערכת AutoHQ), ולכן ייתכן שטרם טופל. '
        'מומלץ לבדוק את הכרטיס ולעדכן את הנתונים במידת הצורך.',
    ]

    # Context block, only the parts we actually know.
    context = []
    month = work_card.processing_month
    if month is not None:
        context.append(f'חודש: {_HE_MONTHS.get(month.month, month.month)} {month.year}')

    employee = getattr(work_card, 'employee', None)
    if employee is not None and getattr(employee, 'full_name', None):
        context.append(f'עובד: {employee.full_name}')

    if work_card.site_id:
        try:
            site = SiteRepository().get_by_id(work_card.site_id)
            if site and getattr(site, 'site_name', None):
                context.append(f'אתר: {site.site_name}')
        except Exception:
            pass

    if context:
        lines.append('')
        lines.extend(context)

    return '\n'.join(lines)


def maybe_notify_new_card(work_card) -> None:
    """Send a 'new card arrived' WhatsApp DM if the business has it enabled and the
    card's upload day falls within the configured window. Best-effort and idempotent
    (guarded by work_cards.whatsapp_notified_at). Never raises.
    """
    try:
        _maybe_notify_new_card(work_card)
    except Exception:
        logger.exception(
            "new-card WhatsApp notification failed for work_card %s (ignored)",
            getattr(work_card, 'id', '?'),
        )


def _maybe_notify_new_card(work_card) -> None:
    # Dedup — already notified (e.g. on an extraction retry).
    if getattr(work_card, 'whatsapp_notified_at', None) is not None:
        return

    settings = WhatsAppNotificationSettingsRepository().get_by_business(work_card.business_id)
    if not settings or not settings.enabled:
        return

    recipient_ids = settings.destination_user_ids or []
    if not recipient_ids:
        return

    day = _upload_day_of_month(work_card.created_at or utc_now())
    if not _in_window(day, settings.start_day, settings.end_day):
        return

    client = WhatsAppListenerClient.from_env()
    if client is None:
        logger.warning("new-card notification skipped: WA_LISTENER_URL not configured")
        return

    file = WorkCardFileRepository().get_by_work_card(work_card.id)
    if not file or not file.image_bytes:
        logger.info("new-card notification skipped: work_card %s has no image", work_card.id)
        return

    caption = _build_caption(work_card)
    content_type = (file.content_type or '').lower()
    is_image = content_type.startswith('image/')
    ext = _IMAGE_EXT.get(content_type, 'jpg')
    filename = f'work_card_{work_card.id}.{ext}'

    user_repo = UserRepository()
    sent_any = False
    for raw_id in recipient_ids:
        try:
            user_id = raw_id if isinstance(raw_id, uuid.UUID) else uuid.UUID(str(raw_id))
        except (ValueError, AttributeError, TypeError):
            logger.info("new-card notification: invalid recipient id %r — skipped", raw_id)
            continue
        user = user_repo.get_by_id(user_id)
        # Defensive tenancy check — only notify users of this business.
        if not user or not user.is_active or user.business_id != work_card.business_id:
            logger.info("new-card notification: recipient %s missing/inactive/foreign — skipped", raw_id)
            continue
        chat_id = format_whatsapp_chat_id(user.phone_number)
        if not chat_id:
            logger.info("new-card notification: user %s has no usable phone — skipped", raw_id)
            continue
        try:
            if is_image:
                client.send_image(
                    chat_id=chat_id,
                    file_bytes=file.image_bytes,
                    caption=caption,
                    mimetype=file.content_type,
                )
            else:
                client.send_document(
                    chat_id=chat_id,
                    file_bytes=file.image_bytes,
                    filename=filename,
                    caption=caption,
                    mimetype=file.content_type,
                )
            sent_any = True
            logger.info("new-card notification sent to user %s for work_card %s", raw_id, work_card.id)
        except WhatsAppListenerError as e:
            logger.warning(
                "new-card notification to user %s failed for work_card %s: %s",
                raw_id, work_card.id, e,
            )

    if sent_any:
        work_card.whatsapp_notified_at = utc_now()
        WhatsAppNotificationSettingsRepository().commit()
