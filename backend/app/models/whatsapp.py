import uuid
from sqlalchemy import Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from ..extensions import db
from ..utils import utc_now


class WhatsAppGroupConfig(db.Model):
    """One row per business — the single WhatsApp group whose images we ingest."""
    __tablename__ = 'whatsapp_group_configs'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_id = db.Column(UUID(as_uuid=True), db.ForeignKey('businesses.id'), unique=True, nullable=False)
    chat_id = db.Column(db.Text, unique=True, nullable=False)
    chat_name = db.Column(db.Text, nullable=True)
    # Cutoff day (1-31): images uploaded on/before this day of the month are
    # assigned to the PREVIOUS month; later uploads to the current month.
    # Single source of truth for WhatsApp month assignment.
    previous_month_cutoff_day = db.Column(db.SmallInteger, nullable=False, server_default='10')
    last_seen_timestamp = db.Column(db.DateTime(timezone=True), nullable=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    __table_args__ = (
        Index('ix_whatsapp_group_configs_chat_id', 'chat_id'),
    )


class WhatsAppNotificationSettings(db.Model):
    """One row per business — config for 'new card arrived' WhatsApp alerts.

    When enabled, any work card uploaded on a day-of-month within [start_day, end_day]
    triggers a WhatsApp DM (image + caption) to each destination platform user.
    """
    __tablename__ = 'whatsapp_notification_settings'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_id = db.Column(UUID(as_uuid=True), db.ForeignKey('businesses.id'), unique=True, nullable=False)
    enabled = db.Column(db.Boolean, nullable=False, server_default='false')
    # Inclusive day-of-month window (1-31) the upload date must fall within.
    start_day = db.Column(db.SmallInteger, nullable=False, server_default='1')
    end_day = db.Column(db.SmallInteger, nullable=False, server_default='31')
    # List of users.id strings to notify. Resolved + validated at send time.
    destination_user_ids = db.Column(JSONB, nullable=False, server_default='[]')
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now)


class WhatsAppIngestedMessage(db.Model):
    """Dedup + audit log for every WhatsApp message the poller has seen."""
    __tablename__ = 'whatsapp_ingested_messages'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    message_id = db.Column(db.Text, unique=True, nullable=False)
    chat_id = db.Column(db.Text, nullable=False)
    chat_name = db.Column(db.Text, nullable=True)
    sender = db.Column(db.Text, nullable=True)
    push_name = db.Column(db.Text, nullable=True)
    message_timestamp = db.Column(db.DateTime(timezone=True), nullable=True)
    work_card_id = db.Column(UUID(as_uuid=True), db.ForeignKey('work_cards.id'), nullable=True)
    status = db.Column(db.Text, nullable=False)  # INGESTED, SKIPPED, ERROR
    error_message = db.Column(db.Text, nullable=True)
    caption = db.Column(db.Text, nullable=True)
    processed_at = db.Column(db.DateTime(timezone=True), default=utc_now)

    __table_args__ = (
        Index('ix_whatsapp_ingested_messages_chat_id', 'chat_id'),
    )
