from typing import Optional, List, Dict, Any
from uuid import UUID
from .base import BaseRepository
from ..models.work_cards import WorkCardDayEntry


class WorkCardDayEntryRepository(BaseRepository[WorkCardDayEntry]):
    """Repository for WorkCardDayEntry model operations."""
    
    def __init__(self):
        super().__init__(WorkCardDayEntry)
    
    def get_by_work_card(self, work_card_id: UUID) -> List[WorkCardDayEntry]:
        """
        Get all day entries for a work card, ordered by day.
        
        Args:
            work_card_id: The work card's UUID
            
        Returns:
            List of WorkCardDayEntry instances
        """
        return self.session.query(WorkCardDayEntry).filter_by(
            work_card_id=work_card_id
        ).order_by(WorkCardDayEntry.day_of_month).all()
    
    def get_by_day(self, work_card_id: UUID, day: int) -> Optional[WorkCardDayEntry]:
        """
        Get the entry for a specific day of a work card.
        
        Args:
            work_card_id: The work card's UUID
            day: The day of the month (1-31)
            
        Returns:
            WorkCardDayEntry instance or None if not found
        """
        return self.session.query(WorkCardDayEntry).filter_by(
            work_card_id=work_card_id,
            day_of_month=day
        ).first()
    
    def bulk_create_entries(self, entries: List[Dict[str, Any]]) -> List[WorkCardDayEntry]:
        """
        Create multiple day entries in bulk.
        
        Args:
            entries: List of dicts with entry data
            
        Returns:
            List of created WorkCardDayEntry instances
        """
        return self.create_many(entries)
    
    def update_entry(
        self, 
        entry_id: UUID, 
        user_id: UUID, 
        **kwargs
    ) -> Optional[WorkCardDayEntry]:
        """
        Update a day entry and track the user who made the change.
        
        Args:
            entry_id: The entry's UUID
            user_id: The user making the update
            **kwargs: Fields to update
            
        Returns:
            The updated WorkCardDayEntry instance or None if not found
        """
        entry = self.get_by_id(entry_id)
        if not entry:
            return None
        
        # Track who made the update
        kwargs['updated_by_user_id'] = user_id
        
        for key, value in kwargs.items():
            if hasattr(entry, key):
                setattr(entry, key, value)
        
        self.session.commit()
        return entry
    
    def get_invalid_entries(self, work_card_id: UUID) -> List[WorkCardDayEntry]:
        """
        Get all invalid entries for a work card.
        
        Args:
            work_card_id: The work card's UUID
            
        Returns:
            List of WorkCardDayEntry instances where is_valid is False
        """
        return self.session.query(WorkCardDayEntry).filter_by(
            work_card_id=work_card_id,
            is_valid=False
        ).all()
    
    def get_valid_entries(self, work_card_id: UUID) -> List[WorkCardDayEntry]:
        """
        Get all valid entries for a work card.
        
        Args:
            work_card_id: The work card's UUID
            
        Returns:
            List of WorkCardDayEntry instances where is_valid is True
        """
        return self.session.query(WorkCardDayEntry).filter_by(
            work_card_id=work_card_id,
            is_valid=True
        ).all()
    
    def mark_invalid(
        self, 
        entry_id: UUID, 
        validation_errors: Dict[str, Any]
    ) -> Optional[WorkCardDayEntry]:
        """
        Mark an entry as invalid with validation errors.
        
        Args:
            entry_id: The entry's UUID
            validation_errors: Dict of validation errors
            
        Returns:
            The updated WorkCardDayEntry instance or None if not found
        """
        entry = self.get_by_id(entry_id)
        if not entry:
            return None
        
        entry.is_valid = False
        entry.validation_errors = validation_errors
        self.session.commit()
        
        return entry
    
    def mark_valid(self, entry_id: UUID) -> Optional[WorkCardDayEntry]:
        """
        Mark an entry as valid and clear validation errors.
        
        Args:
            entry_id: The entry's UUID
            
        Returns:
            The updated WorkCardDayEntry instance or None if not found
        """
        entry = self.get_by_id(entry_id)
        if not entry:
            return None
        
        entry.is_valid = True
        entry.validation_errors = None
        self.session.commit()
        
        return entry
