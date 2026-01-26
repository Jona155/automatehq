from typing import Optional, List
from uuid import UUID
from .base import BaseRepository
from ..models.users import User


class UserRepository(BaseRepository[User]):
    """Repository for User model operations."""
    
    def __init__(self):
        super().__init__(User)
    
    def get_by_email(self, email: str) -> Optional[User]:
        """
        Get a user by email address.
        
        Args:
            email: The user's email address
            
        Returns:
            User instance or None if not found
        """
        return self.session.query(User).filter_by(email=email).first()
    
    def get_by_phone(self, phone: str) -> Optional[User]:
        """
        Get a user by phone number.
        
        Args:
            phone: The user's phone number
            
        Returns:
            User instance or None if not found
        """
        return self.session.query(User).filter_by(phone_number=phone).first()
    
    def get_active_users(self) -> List[User]:
        """
        Get all active users.
        
        Returns:
            List of active User instances
        """
        return self.session.query(User).filter_by(is_active=True).all()
    
    def get_by_role(self, role: str) -> List[User]:
        """
        Get all users with a specific role.
        
        Args:
            role: The role to filter by (ADMIN, EMPLOYEE, RESPONSIBLE_EMPLOYEE)
            
        Returns:
            List of User instances with the specified role
        """
        return self.session.query(User).filter_by(role=role).all()
    
    def deactivate(self, user_id: UUID) -> bool:
        """
        Deactivate a user account.
        
        Args:
            user_id: The UUID of the user to deactivate
            
        Returns:
            True if deactivated successfully, False if user not found
        """
        user = self.get_by_id(user_id)
        if not user:
            return False
        
        user.is_active = False
        self.session.commit()
        return True
    
    def activate(self, user_id: UUID) -> bool:
        """
        Activate a user account.
        
        Args:
            user_id: The UUID of the user to activate
            
        Returns:
            True if activated successfully, False if user not found
        """
        user = self.get_by_id(user_id)
        if not user:
            return False
        
        user.is_active = True
        self.session.commit()
        return True
