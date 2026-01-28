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
