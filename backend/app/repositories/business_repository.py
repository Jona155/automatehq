from typing import Optional, List
from uuid import UUID
from .base import BaseRepository
from ..models.business import Business


class BusinessRepository(BaseRepository[Business]):
    """Repository for Business model operations."""
    
    def __init__(self):
        super().__init__(Business)
    
    def get_by_name(self, business_name: str) -> Optional[Business]:
        """
        Get a business by name.
        
        Args:
            business_name: The business name
            
        Returns:
            Business instance or None if not found
        """
        return self.session.query(Business).filter_by(business_name=business_name).first()
    
    def get_by_code(self, business_code: str) -> Optional[Business]:
        """
        Get a business by code.
        
        Args:
            business_code: The business code
            
        Returns:
            Business instance or None if not found
        """
        return self.session.query(Business).filter_by(business_code=business_code).first()
    
    def get_active_businesses(self) -> List[Business]:
        """
        Get all active businesses.
        
        Returns:
            List of active Business instances
        """
        return self.session.query(Business).filter_by(is_active=True).all()
    
    def deactivate(self, business_id: UUID) -> bool:
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
    
    def activate(self, business_id: UUID) -> bool:
        """
        Activate a business.
        
        Args:
            business_id: The UUID of the business to activate
            
        Returns:
            True if activated successfully, False if business not found
        """
        business = self.get_by_id(business_id)
        if not business:
            return False
        
        business.is_active = True
        self.session.commit()
        return True
