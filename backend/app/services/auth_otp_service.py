from __future__ import annotations

import hashlib
import hmac
import logging
import os
import secrets
import uuid
from dataclasses import dataclass
from datetime import timedelta

from ..extensions import db
from ..models.auth import AuthOtpChallenge
from ..models.users import User
from ..repositories.auth_otp_repository import AuthOtpChallengeRepository
from ..services.whatsapp_listener_client import WhatsAppListenerClient, WhatsAppListenerError
from ..utils import format_whatsapp_chat_id, utc_now

logger = logging.getLogger(__name__)

OTP_TTL_SECONDS = 10 * 60
OTP_RESEND_COOLDOWN_SECONDS = 60
OTP_MAX_ATTEMPTS = 5
OTP_MAX_SENDS_PER_CHALLENGE = 3
OTP_MAX_CHALLENGES_PER_HOUR = 5
OTP_MAX_CHALLENGES_PER_IP_HOUR = 20
OTP_RETENTION_DAYS = 7


class OtpError(Exception):
    status_code = 400


class OtpRateLimited(OtpError):
    status_code = 429


class OtpDeliveryFailed(OtpError):
    status_code = 503


class OtpChallengeExpired(OtpError):
    status_code = 410


class OtpInvalidCode(OtpError):
    status_code = 401


@dataclass
class OtpChallengeResult:
    challenge_id: str
    expires_at: str
    masked_phone: str
    resend_after_seconds: int = OTP_RESEND_COOLDOWN_SECONDS


def _secret() -> bytes:
    value = (
        os.environ.get('OTP_SECRET_KEY')
        or os.environ.get('JWT_SECRET_KEY')
        or os.environ.get('SECRET_KEY')
    )
    if not value:
        raise RuntimeError('OTP_SECRET_KEY or JWT_SECRET_KEY must be configured')
    return value.encode('utf-8')


def _digest(challenge_id: uuid.UUID, value: str) -> str:
    payload = f'{challenge_id}:{value}'.encode('utf-8')
    return hmac.new(_secret(), payload, hashlib.sha256).hexdigest()


def _generate_code() -> str:
    return f'{secrets.randbelow(1_000_000):06d}'


def _mask_phone(phone_number: str) -> str:
    digits = ''.join(character for character in phone_number if character.isdigit())
    return f'***{digits[-4:]}' if len(digits) >= 4 else '***'


def _send_code(phone_number: str, code: str) -> None:
    client = WhatsAppListenerClient.from_env()
    if client is None:
        raise OtpDeliveryFailed('שירות WhatsApp אינו זמין כרגע')

    chat_id = format_whatsapp_chat_id(phone_number)
    if not chat_id:
        raise OtpDeliveryFailed('לא מוגדר מספר WhatsApp תקין לחשבון')

    message = (
        f'קוד האימות שלך ל-AutomateHQ הוא {code}.\n'
        'הקוד תקף ל-10 דקות. אם לא ביקשת להתחבר, יש להתעלם מהודעה זו.'
    )
    try:
        client.send(chat_id, message)
    except WhatsAppListenerError as exc:
        logger.warning('WhatsApp OTP delivery failed: %s', exc)
        raise OtpDeliveryFailed('לא הצלחנו לשלוח את קוד האימות ב-WhatsApp') from exc


def cleanup_old_otp_challenges(now=None) -> int:
    """Delete challenges that expired more than the retention period ago."""
    cutoff = (now or utc_now()) - timedelta(days=OTP_RETENTION_DAYS)
    return AuthOtpChallengeRepository().delete_expired_before(cutoff)


def request_challenge(user, request_ip: str) -> OtpChallengeResult:
    repository = AuthOtpChallengeRepository()
    now = utc_now()
    one_hour_ago = now - timedelta(hours=1)
    ip_digest = _digest(uuid.UUID(int=0), request_ip or 'unknown')

    # Serialize requests for one user so two concurrent sends cannot leave two
    # different valid codes behind.
    user = (
        db.session.query(User)
        .filter(User.id == user.id)
        .with_for_update()
        .one()
    )

    if repository.count_recent_for_user(user.id, one_hour_ago) >= OTP_MAX_CHALLENGES_PER_HOUR:
        db.session.rollback()
        raise OtpRateLimited('נשלחו יותר מדי קודים. יש לנסות שוב מאוחר יותר')
    if repository.count_recent_for_ip(ip_digest, one_hour_ago) >= OTP_MAX_CHALLENGES_PER_IP_HOUR:
        db.session.rollback()
        raise OtpRateLimited('יותר מדי ניסיונות. יש לנסות שוב מאוחר יותר')

    code = _generate_code()
    challenge_id = uuid.uuid4()
    repository.invalidate_active_for_user(user.id, now)
    challenge = AuthOtpChallenge(
        id=challenge_id,
        user_id=user.id,
        code_digest=_digest(challenge_id, code),
        request_ip_digest=ip_digest,
        expires_at=now + timedelta(seconds=OTP_TTL_SECONDS),
        last_sent_at=now,
    )
    db.session.add(challenge)
    db.session.commit()

    try:
        _send_code(user.phone_number, code)
    except OtpDeliveryFailed:
        # The caller never receives this challenge id when delivery fails, so
        # keeping the row serves no authentication purpose. More importantly,
        # hourly limits count challenge rows; retaining failed deliveries would
        # lock a user out after five provider/network errors even though no code
        # reached them.
        db.session.delete(challenge)
        db.session.commit()
        raise

    return OtpChallengeResult(
        challenge_id=str(challenge.id),
        expires_at=challenge.expires_at.isoformat(),
        masked_phone=_mask_phone(user.phone_number),
    )


def resend_challenge(challenge_id: uuid.UUID) -> OtpChallengeResult:
    repository = AuthOtpChallengeRepository()
    now = utc_now()
    challenge = repository.get_for_update(challenge_id)

    if not challenge or challenge.consumed_at or challenge.invalidated_at or challenge.expires_at <= now:
        db.session.rollback()
        raise OtpChallengeExpired('בקשת האימות אינה תקפה. יש לבקש קוד חדש')
    if challenge.send_count >= OTP_MAX_SENDS_PER_CHALLENGE:
        db.session.rollback()
        raise OtpRateLimited('הגעת למספר השליחות המרבי. יש לבקש קוד חדש מאוחר יותר')

    elapsed = (now - challenge.last_sent_at).total_seconds()
    if elapsed < OTP_RESEND_COOLDOWN_SECONDS:
        db.session.rollback()
        retry_after = max(1, int(OTP_RESEND_COOLDOWN_SECONDS - elapsed))
        raise OtpRateLimited(f'ניתן לשלוח קוד חדש בעוד {retry_after} שניות')

    user = challenge.user
    code = _generate_code()
    challenge.code_digest = _digest(challenge.id, code)
    challenge.expires_at = now + timedelta(seconds=OTP_TTL_SECONDS)
    challenge.failed_attempts = 0
    challenge.send_count += 1
    challenge.last_sent_at = now
    db.session.commit()

    try:
        _send_code(user.phone_number, code)
    except OtpDeliveryFailed:
        challenge.invalidated_at = utc_now()
        db.session.commit()
        raise

    return OtpChallengeResult(
        challenge_id=str(challenge.id),
        expires_at=challenge.expires_at.isoformat(),
        masked_phone=_mask_phone(user.phone_number),
    )


def verify_challenge(challenge_id: uuid.UUID, code: str):
    repository = AuthOtpChallengeRepository()
    now = utc_now()
    challenge = repository.get_for_update(challenge_id)

    if not challenge or challenge.consumed_at or challenge.invalidated_at:
        db.session.rollback()
        raise OtpChallengeExpired('בקשת האימות אינה תקפה. יש לבקש קוד חדש')
    if challenge.expires_at <= now:
        challenge.invalidated_at = now
        db.session.commit()
        raise OtpChallengeExpired('פג תוקף קוד האימות. יש לבקש קוד חדש')
    if challenge.failed_attempts >= OTP_MAX_ATTEMPTS:
        challenge.invalidated_at = now
        db.session.commit()
        raise OtpInvalidCode('יותר מדי ניסיונות שגויים. יש לבקש קוד חדש')

    if not hmac.compare_digest(challenge.code_digest, _digest(challenge.id, code)):
        challenge.failed_attempts += 1
        if challenge.failed_attempts >= OTP_MAX_ATTEMPTS:
            challenge.invalidated_at = now
        db.session.commit()
        raise OtpInvalidCode('קוד האימות שגוי')

    challenge.consumed_at = now
    user = challenge.user
    db.session.commit()
    return user
