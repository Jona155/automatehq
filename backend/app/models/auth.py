import uuid

from sqlalchemy import Index
from sqlalchemy.dialects.postgresql import UUID

from ..extensions import db
from ..utils import utc_now


class AuthOtpChallenge(db.Model):
    __tablename__ = 'auth_otp_challenges'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    user_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('users.id', ondelete='CASCADE'),
        nullable=False,
    )
    code_digest = db.Column(db.String(64), nullable=False)
    request_ip_digest = db.Column(db.String(64), nullable=True)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=False)
    consumed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    invalidated_at = db.Column(db.DateTime(timezone=True), nullable=True)
    failed_attempts = db.Column(db.Integer, nullable=False, default=0)
    send_count = db.Column(db.Integer, nullable=False, default=1)
    last_sent_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now)
    created_at = db.Column(db.DateTime(timezone=True), nullable=False, default=utc_now)

    # Keep this relationship lazy so SELECT ... FOR UPDATE locks only the
    # challenge row (PostgreSQL rejects a lock on the nullable side of a join).
    user = db.relationship('User', lazy='select')

    __table_args__ = (
        Index('ix_auth_otp_challenges_user_created', 'user_id', 'created_at'),
        Index('ix_auth_otp_challenges_ip_created', 'request_ip_digest', 'created_at'),
        Index('ix_auth_otp_challenges_expires_at', 'expires_at'),
    )
