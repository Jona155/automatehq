from typing import Optional, List
from uuid import UUID
from .base import BaseRepository
from ..models.users import User


class UserRepository(BaseRepository[User]):
    """Repository for User model operations."""
    
    def __init__(self):
        super().__init__(User)
    
    def get_by_email(self, email: str, business_id: Optional[UUID] = None) -> Optional[User]:
        """
        Get a user by email address.
        Email is globally unique, but can optionally verify business ownership.
        
        Args:
            email: The user's email address
            business_id: Optional business_id to verify ownership
            
        Returns:
            User instance or None if not found
        """
        query = self.session.query(User).filter_by(email=email)
        if business_id:
            query = query.filter_by(business_id=business_id)
        return query.first()
    
    def get_by_phone(self, phone: str, business_id: Optional[UUID] = None) -> Optional[User]:
        """
        Get a user by phone number.
        Phone is globally unique, but can optionally verify business ownership.
        
        Args:
            phone: The user's phone number
            business_id: Optional business_id to verify ownership
            
        Returns:
            User instance or None if not found
        """
        query = self.session.query(User).filter_by(phone_number=phone)
        if business_id:
            query = query.filter_by(business_id=business_id)
        return query.first()
    
    def get_active_users(self, business_id: UUID) -> List[User]:
        """
        Get all active users for a business.
        
        Args:
            business_id: The business UUID
        
        Returns:
            List of active User instances
        """
        return self.session.query(User).filter_by(
            business_id=business_id,
            is_active=True
        ).all()
    
    def get_by_role(self, role: str, business_id: UUID) -> List[User]:
        """
        Get all users with a specific role in a business.
        
        Args:
            role: The role to filter by (ADMIN, EMPLOYEE, RESPONSIBLE_EMPLOYEE)
            business_id: The business UUID
            
        Returns:
            List of User instances with the specified role
        """
        return self.session.query(User).filter_by(
            role=role,
            business_id=business_id
        ).all()
    
    def get_all_for_business(self, business_id: UUID) -> List[User]:
        """
        Get all users for a business.
        
        Args:
            business_id: The business UUID
            
        Returns:
            List of User instances
        """
        return self.session.query(User).filter_by(business_id=business_id).all()
    
    def deactivate(self, user_id: UUID, business_id: UUID) -> bool:
        """
        Deactivate a user account.
        
        Args:
            user_id: The UUID of the user to deactivate
            business_id: The business UUID to verify ownership
            
        Returns:
            True if deactivated successfully, False if user not found
        """
        user = self.session.query(User).filter_by(
            id=user_id,
            business_id=business_id
        ).first()
        if not user:
            return False
        
        user.is_active = False
        self.session.commit()
        return True
    
    def activate(self, user_id: UUID, business_id: UUID) -> bool:
        """
        Activate a user account.
        
        Args:
            user_id: The UUID of the user to activate
            business_id: The business UUID to verify ownership
            
        Returns:
            True if activated successfully, False if user not found
        """
        user = self.session.query(User).filter_by(
            id=user_id,
            business_id=business_id
        ).first()
        if not user:
            return False
        
        user.is_active = True
        self.session.commit()
        return True
