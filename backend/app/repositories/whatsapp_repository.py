from typing import Optional, List
from datetime import date, datetime
from uuid import UUID
from sqlalchemy.exc import SQLAlchemyError

from .base import BaseRepository
from ..models.whatsapp import WhatsAppGroupConfig, WhatsAppIngestedMessage
from ..utils import utc_now


class WhatsAppGroupConfigRepository(BaseRepository[WhatsAppGroupConfig]):
    def __init__(self):
        super().__init__(WhatsAppGroupConfig)

    def get_by_business(self, business_id: UUID) -> Optional[WhatsAppGroupConfig]:
        return self.session.query(WhatsAppGroupConfig).filter_by(business_id=business_id).first()

    def get_by_chat_id(self, chat_id: str) -> Optional[WhatsAppGroupConfig]:
        return self.session.query(WhatsAppGroupConfig).filter_by(chat_id=chat_id).first()

    def list_all_active(self) -> List[WhatsAppGroupConfig]:
        return self.session.query(WhatsAppGroupConfig).filter_by(is_active=True).all()

    def delete_by_business(self, business_id: UUID) -> Optional[str]:
        """Delete the config for a business. Returns the former chat_id if a row existed."""
        config = self.get_by_business(business_id)
        if not config:
            return None
        chat_id = config.chat_id
        try:
            self.session.delete(config)
            self.session.commit()
            return chat_id
        except SQLAlchemyError as e:
            self.session.rollback()
            raise e

    def update_cursor(self, config_id: UUID, last_seen: datetime) -> None:
        try:
            config = self.get_by_id(config_id)
            if not config:
                return
            config.last_seen_timestamp = last_seen
            config.updated_at = utc_now()
            self.session.commit()
        except SQLAlchemyError as e:
            self.session.rollback()
            raise e

    def advance_month_if_due(self, config: WhatsAppGroupConfig) -> bool:
        """Mirror Telegram's auto-advance. Returns True if the month was advanced."""
        if config.auto_advance_day is None:
            return False

        today = date.today()
        if today.day < config.auto_advance_day:
            return False

        current_month_first = date(today.year, today.month, 1)
        if config.current_processing_month >= current_month_first:
            return False

        try:
            config.current_processing_month = current_month_first
            config.updated_at = utc_now()
            self.session.commit()
            return True
        except SQLAlchemyError as e:
            self.session.rollback()
            raise e


class WhatsAppIngestedMessageRepository(BaseRepository[WhatsAppIngestedMessage]):
    def __init__(self):
        super().__init__(WhatsAppIngestedMessage)

    def exists_by_message_id(self, message_id: str) -> bool:
        return self.session.query(
            self.session.query(WhatsAppIngestedMessage)
            .filter_by(message_id=message_id)
            .exists()
        ).scalar()
