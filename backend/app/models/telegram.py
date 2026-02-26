import uuid
from sqlalchemy import Index
from sqlalchemy.dialects.postgresql import UUID
from ..extensions import db
from ..utils import utc_now


class TelegramBotConfig(db.Model):
    __tablename__ = 'telegram_bot_configs'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_id = db.Column(UUID(as_uuid=True), db.ForeignKey('businesses.id'), unique=True, nullable=False)
    telegram_chat_id = db.Column(db.BigInteger, nullable=False)
    current_processing_month = db.Column(db.Date, nullable=False)
    auto_advance_day = db.Column(db.SmallInteger, nullable=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    __table_args__ = (
        Index('ix_telegram_bot_config_chat_id', 'telegram_chat_id'),
    )


class TelegramIngestedFile(db.Model):
    __tablename__ = 'telegram_ingested_files'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    file_unique_id = db.Column(db.Text, unique=True, nullable=False)
    telegram_update_id = db.Column(db.BigInteger, nullable=True)
    telegram_user_id = db.Column(db.BigInteger, nullable=True)
    telegram_username = db.Column(db.Text, nullable=True)
    telegram_chat_id = db.Column(db.BigInteger, nullable=True)
    message_timestamp = db.Column(db.DateTime(timezone=True), nullable=True)
    work_card_id = db.Column(UUID(as_uuid=True), db.ForeignKey('work_cards.id'), nullable=True)
    status = db.Column(db.Text, nullable=False)  # INGESTED, SKIPPED, ERROR
    error_message = db.Column(db.Text, nullable=True)
    processed_at = db.Column(db.DateTime(timezone=True), default=utc_now)


class TelegramPollingState(db.Model):
    __tablename__ = 'telegram_polling_state'

    id = db.Column(db.Integer, primary_key=True)  # always 1
    last_offset = db.Column(db.BigInteger, nullable=False, default=0)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now)
