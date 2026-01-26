from typing import Optional, List
from uuid import UUID
from datetime import date
from sqlalchemy.orm import joinedload
from .base import BaseRepository
from ..models.work_cards import WorkCard
from ..utils import utc_now


class WorkCardRepository(BaseRepository[WorkCard]):
    """Repository for WorkCard model operations."""
    
    def __init__(self):
        super().__init__(WorkCard)
    
    def get_by_site_month(self, site_id: UUID, month: date) -> List[WorkCard]:
        """
        Get all work cards for a site and month.
        
        Args:
            site_id: The site's UUID
            month: The processing month
            
        Returns:
            List of WorkCard instances
        """
        return self.session.query(WorkCard).filter_by(
            site_id=site_id,
            processing_month=month
        ).all()
    
    def get_by_employee_month(self, employee_id: UUID, month: date) -> List[WorkCard]:
        """
        Get all work cards for an employee and month.
        
        Args:
            employee_id: The employee's UUID
            month: The processing month
            
        Returns:
            List of WorkCard instances
        """
        return self.session.query(WorkCard).filter_by(
            employee_id=employee_id,
            processing_month=month
        ).all()
    
    def get_by_review_status(self, status: str) -> List[WorkCard]:
        """
        Get all work cards with a specific review status.
        
        Args:
            status: The review status (NEEDS_REVIEW, APPROVED, etc.)
            
        Returns:
            List of WorkCard instances
        """
        return self.session.query(WorkCard).filter_by(review_status=status).all()
    
    def get_unassigned_cards(self) -> List[WorkCard]:
        """
        Get all work cards without an assigned employee.
        
        Returns:
            List of WorkCard instances with no employee_id
        """
        return self.session.query(WorkCard).filter(
            WorkCard.employee_id.is_(None)
        ).all()
    
    def get_pending_review(self, site_id: Optional[UUID] = None) -> List[WorkCard]:
        """
        Get all work cards pending review, optionally filtered by site.
        
        Args:
            site_id: Optional site UUID to filter by
            
        Returns:
            List of WorkCard instances with NEEDS_REVIEW status
        """
        query = self.session.query(WorkCard).filter_by(review_status='NEEDS_REVIEW')
        
        if site_id:
            query = query.filter_by(site_id=site_id)
        
        return query.all()
    
    def approve_card(self, card_id: UUID, user_id: UUID) -> Optional[WorkCard]:
        """
        Approve a work card.
        
        Args:
            card_id: The work card's UUID
            user_id: The approving user's UUID
            
        Returns:
            The approved WorkCard instance or None if not found
        """
        card = self.get_by_id(card_id)
        if not card:
            return None
        
        card.review_status = 'APPROVED'
        card.approved_by_user_id = user_id
        card.approved_at = utc_now()
        self.session.commit()
        
        return card
    
    def bulk_approve(self, card_ids: List[UUID], user_id: UUID) -> int:
        """
        Approve multiple work cards.
        
        Args:
            card_ids: List of work card UUIDs to approve
            user_id: The approving user's UUID
            
        Returns:
            Number of cards approved
        """
        count = self.session.query(WorkCard).filter(
            WorkCard.id.in_(card_ids)
        ).update({
            'review_status': 'APPROVED',
            'approved_by_user_id': user_id,
            'approved_at': utc_now()
        }, synchronize_session=False)
        
        self.session.commit()
        return count
    
    def get_with_extraction(self, card_id: UUID) -> Optional[WorkCard]:
        """
        Get a work card with its extraction eagerly loaded.
        
        Args:
            card_id: The work card's UUID
            
        Returns:
            WorkCard instance with extraction loaded or None if not found
        """
        return self.session.query(WorkCard).options(
            joinedload(WorkCard.extraction)
        ).filter_by(id=card_id).first()
    
    def get_with_day_entries(self, card_id: UUID) -> Optional[WorkCard]:
        """
        Get a work card with its day entries eagerly loaded.
        
        Args:
            card_id: The work card's UUID
            
        Returns:
            WorkCard instance with day_entries loaded or None if not found
        """
        return self.session.query(WorkCard).options(
            joinedload(WorkCard.day_entries)
        ).filter_by(id=card_id).first()
    
    def get_with_all_relations(self, card_id: UUID) -> Optional[WorkCard]:
        """
        Get a work card with all its relations eagerly loaded.
        
        Args:
            card_id: The work card's UUID
            
        Returns:
            WorkCard instance with all relations loaded or None if not found
        """
        return self.session.query(WorkCard).options(
            joinedload(WorkCard.extraction),
            joinedload(WorkCard.day_entries),
            joinedload(WorkCard.files)
        ).filter_by(id=card_id).first()
    
    def update_review_status(self, card_id: UUID, status: str) -> Optional[WorkCard]:
        """
        Update the review status of a work card.
        
        Args:
            card_id: The work card's UUID
            status: The new review status
            
        Returns:
            The updated WorkCard instance or None if not found
        """
        card = self.get_by_id(card_id)
        if not card:
            return None
        
        card.review_status = status
        self.session.commit()
        
        return card
