from typing import Optional
from datetime import date
from uuid import UUID
from sqlalchemy.exc import SQLAlchemyError

from .base import BaseRepository
from ..models.telegram import TelegramBotConfig, TelegramIngestedFile, TelegramPollingState
from ..extensions import db
from ..utils import utc_now


class TelegramConfigRepository(BaseRepository[TelegramBotConfig]):
    def __init__(self):
        super().__init__(TelegramBotConfig)

    def get_by_business(self, business_id: UUID) -> Optional[TelegramBotConfig]:
        return self.session.query(TelegramBotConfig).filter_by(business_id=business_id).first()

    def get_by_chat_id(self, chat_id: int) -> Optional[TelegramBotConfig]:
        return self.session.query(TelegramBotConfig).filter_by(telegram_chat_id=chat_id).first()

    def advance_month_if_due(self, config: TelegramBotConfig) -> bool:
        """Check if month should auto-advance and do so. Returns True if advanced."""
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


class TelegramIngestedFileRepository(BaseRepository[TelegramIngestedFile]):
    def __init__(self):
        super().__init__(TelegramIngestedFile)

    def exists_by_file_unique_id(self, file_unique_id: str) -> bool:
        return self.session.query(
            self.session.query(TelegramIngestedFile)
            .filter_by(file_unique_id=file_unique_id)
            .exists()
        ).scalar()


class TelegramPollingStateRepository:
    def __init__(self):
        self.session = db.session

    def get_or_create(self) -> TelegramPollingState:
        state = self.session.query(TelegramPollingState).filter_by(id=1).first()
        if state is None:
            state = TelegramPollingState(id=1, last_offset=0)
            self.session.add(state)
            self.session.commit()
        return state

    def set_offset(self, offset: int) -> None:
        try:
            state = self.get_or_create()
            state.last_offset = offset
            state.updated_at = utc_now()
            self.session.commit()
        except SQLAlchemyError as e:
            self.session.rollback()
            raise e
