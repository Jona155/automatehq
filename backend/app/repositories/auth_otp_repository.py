from datetime import datetime
from typing import Optional
from uuid import UUID

from .base import BaseRepository
from ..models.auth import AuthOtpChallenge


class AuthOtpChallengeRepository(BaseRepository[AuthOtpChallenge]):
    def __init__(self):
        super().__init__(AuthOtpChallenge)

    def get_for_update(self, challenge_id: UUID) -> Optional[AuthOtpChallenge]:
        return (
            self.session.query(AuthOtpChallenge)
            .filter(AuthOtpChallenge.id == challenge_id)
            .with_for_update()
            .first()
        )

    def invalidate_active_for_user(self, user_id: UUID, now: datetime) -> None:
        (
            self.session.query(AuthOtpChallenge)
            .filter(
                AuthOtpChallenge.user_id == user_id,
                AuthOtpChallenge.consumed_at.is_(None),
                AuthOtpChallenge.invalidated_at.is_(None),
            )
            .update({'invalidated_at': now}, synchronize_session=False)
        )

    def count_recent_for_user(self, user_id: UUID, since: datetime) -> int:
        return (
            self.session.query(AuthOtpChallenge)
            .filter(
                AuthOtpChallenge.user_id == user_id,
                AuthOtpChallenge.created_at >= since,
            )
            .count()
        )

    def count_recent_for_ip(self, ip_digest: str, since: datetime) -> int:
        return (
            self.session.query(AuthOtpChallenge)
            .filter(
                AuthOtpChallenge.request_ip_digest == ip_digest,
                AuthOtpChallenge.created_at >= since,
            )
            .count()
        )

    def delete_expired_before(self, cutoff: datetime) -> int:
        """Delete challenges whose validity ended before the retention cutoff."""
        try:
            deleted = (
                self.session.query(AuthOtpChallenge)
                .filter(AuthOtpChallenge.expires_at < cutoff)
                .delete(synchronize_session=False)
            )
            self.session.commit()
            return deleted
        except Exception:
            self.session.rollback()
            raise
