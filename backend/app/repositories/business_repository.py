from typing import Optional
from .base import BaseRepository
from ..models.business import Business


class BusinessRepository(BaseRepository[Business]):
    """Repository for Business model operations."""
    
    def __init__(self):
        super().__init__(Business)
    
    def get_by_code(self, code: str) -> Optional[Business]:
        """
        Get a business by its URL-friendly code.
        
        Args:
            code: The business code (slug)
            
        Returns:
            Business instance or None if not found
        """
        return self.session.query(Business).filter_by(code=code).first()
    
    def get_by_name(self, name: str) -> Optional[Business]:
        """
        Get a business by its name.
        
        Args:
            name: The business name
            
        Returns:
            Business instance or None if not found
        """
        return self.session.query(Business).filter_by(name=name).first()
    
    def get_active_businesses(self):
        """
        Get all active businesses.
        
        Returns:
            List of active Business instances
        """
        return self.session.query(Business).filter_by(is_active=True).all()
    
    def deactivate(self, business_id) -> bool:
        """
        Deactivate a business.
        
        Args:
            business_id: The UUID of the business to deactivate
            
        Returns:
            True if deactivated successfully, False if business not found
        """
        business = self.get_by_id(business_id)
        if not business:
            return False
        
        business.is_active = False
        self.session.commit()
        return True

    def hard_delete(self, business_id) -> bool:
        """Permanently delete a business and every row that belongs to it.

        The API only ever soft-deletes (see `deactivate`); this is for admin
        cleanup and tests. A plain `session.delete(business)` cannot do this:
        the child FKs are NOT NULL, so SQLAlchemy's default cascade tries to
        NULL them and raises. Some rows also reference `work_cards` with FKs
        that have no ON DELETE rule and would otherwise block the delete. So we
        remove everything explicitly, children before parents, in one
        transaction. Returns False if the business does not exist.
        """
        from ..models.work_cards import (
            WorkCard, WorkCardFile, WorkCardExtraction, WorkCardDayEntry,
        )
        from ..models.sites import Site, Employee
        from ..models.users import User
        from ..models.audit import ExportRun, AuditEvent
        from ..models.upload_access import UploadAccessRequest
        from ..models.whatsapp import (
            WhatsAppGroupConfig, WhatsAppNotificationSettings, WhatsAppIngestedMessage,
        )
        from ..models.telegram import TelegramBotConfig, TelegramIngestedFile

        business = self.get_by_id(business_id)
        if not business:
            return False

        s = self.session

        def wipe(model, *filters):
            s.query(model).filter(*filters).delete(synchronize_session=False)

        card_ids = [row[0] for row in s.query(WorkCard.id).filter(
            WorkCard.business_id == business_id).all()]

        if card_ids:
            # Rows that reference work_cards via FKs with no ON DELETE rule —
            # remove them first so deleting the cards doesn't hit a constraint.
            wipe(WhatsAppIngestedMessage, WhatsAppIngestedMessage.work_card_id.in_(card_ids))
            wipe(TelegramIngestedFile, TelegramIngestedFile.work_card_id.in_(card_ids))
            wipe(WorkCardDayEntry, WorkCardDayEntry.work_card_id.in_(card_ids))
            wipe(WorkCardFile, WorkCardFile.work_card_id.in_(card_ids))
            wipe(WorkCardExtraction, WorkCardExtraction.work_card_id.in_(card_ids))

        # Business-owned rows that point at work_cards/employees/sites/users.
        wipe(AuditEvent, AuditEvent.business_id == business_id)
        wipe(ExportRun, ExportRun.business_id == business_id)
        wipe(UploadAccessRequest, UploadAccessRequest.business_id == business_id)
        wipe(WorkCard, WorkCard.business_id == business_id)
        wipe(WhatsAppGroupConfig, WhatsAppGroupConfig.business_id == business_id)
        wipe(WhatsAppNotificationSettings, WhatsAppNotificationSettings.business_id == business_id)
        wipe(TelegramBotConfig, TelegramBotConfig.business_id == business_id)
        # Employees before sites (sites.field_manager_id -> employees is ON
        # DELETE SET NULL, so the sites still standing get nulled automatically).
        wipe(Employee, Employee.business_id == business_id)
        wipe(Site, Site.business_id == business_id)
        wipe(User, User.business_id == business_id)

        s.delete(business)
        s.commit()
        return True
