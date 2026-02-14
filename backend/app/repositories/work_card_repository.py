from typing import Optional, List
from uuid import UUID
from datetime import date
from sqlalchemy.orm import joinedload
from sqlalchemy import or_
from .base import BaseRepository
from ..models.work_cards import WorkCard
from ..models.sites import Employee
from ..utils import utc_now


class WorkCardRepository(BaseRepository[WorkCard]):
    """Repository for WorkCard model operations."""
    
    def __init__(self):
        super().__init__(WorkCard)
    
    def get_by_site_month(self, site_id: UUID, month: date, business_id: UUID) -> List[WorkCard]:
        """
        Get all work cards for a site and month in a business.
        
        Args:
            site_id: The site's UUID
            month: The processing month
            business_id: The business UUID
            
        Returns:
            List of WorkCard instances
        """
        return self.session.query(WorkCard).filter_by(
            site_id=site_id,
            processing_month=month,
            business_id=business_id
        ).all()
    
    def get_by_site_month_with_employee(self, site_id: UUID, month: date, business_id: UUID) -> List[WorkCard]:
        """
        Get all work cards for a site and month in a business with employee data eagerly loaded.
        
        Args:
            site_id: The site's UUID
            month: The processing month
            business_id: The business UUID
            
        Returns:
            List of WorkCard instances with employee relationship loaded
        """
        return self.session.query(WorkCard).options(
            joinedload(WorkCard.employee)
        ).filter_by(
            site_id=site_id,
            processing_month=month,
            business_id=business_id
        ).order_by(WorkCard.created_at.desc()).all()
    
    def get_by_employee_month(self, employee_id: UUID, month: date, business_id: UUID) -> List[WorkCard]:
        """
        Get all work cards for an employee and month in a business.
        
        Args:
            employee_id: The employee's UUID
            month: The processing month
            business_id: The business UUID
            
        Returns:
            List of WorkCard instances
        """
        return self.session.query(WorkCard).filter_by(
            employee_id=employee_id,
            processing_month=month,
            business_id=business_id
        ).order_by(WorkCard.created_at.desc()).all()

    def get_previous_card_for_employee_month(
        self,
        employee_id: UUID,
        month: date,
        business_id: UUID,
        current_card_id: UUID,
        site_id: Optional[UUID] = None,
        include_day_entries: bool = False
    ) -> Optional[WorkCard]:
        """
        Get the immediate previous work card for an employee/month in a business.

        Args:
            employee_id: Employee UUID
            month: Processing month
            business_id: Business UUID
            current_card_id: Current card UUID to exclude from lookup
            site_id: Optional site UUID filter
            include_day_entries: Whether to eager load day_entries

        Returns:
            Previous WorkCard instance or None
        """
        query = self.session.query(WorkCard).filter(
            WorkCard.employee_id == employee_id,
            WorkCard.processing_month == month,
            WorkCard.business_id == business_id,
            WorkCard.id != current_card_id
        )

        if site_id:
            query = query.filter(WorkCard.site_id == site_id)

        if include_day_entries:
            query = query.options(joinedload(WorkCard.day_entries))

        return query.order_by(WorkCard.created_at.desc()).first()
    
    def get_by_review_status(self, status: str, business_id: UUID) -> List[WorkCard]:
        """
        Get all work cards with a specific review status for a business.
        
        Args:
            status: The review status (NEEDS_REVIEW, APPROVED, etc.)
            business_id: The business UUID
            
        Returns:
            List of WorkCard instances
        """
        return self.session.query(WorkCard).filter_by(
            review_status=status,
            business_id=business_id
        ).all()
    
    def get_unassigned_cards(self, business_id: UUID) -> List[WorkCard]:
        """
        Get all work cards without an assigned employee for a business.
        
        Args:
            business_id: The business UUID
        
        Returns:
            List of WorkCard instances with no employee_id
        """
        return self.session.query(WorkCard).filter(
            WorkCard.employee_id.is_(None),
            WorkCard.business_id == business_id
        ).all()
    
    def get_pending_review(self, business_id: UUID, site_id: Optional[UUID] = None) -> List[WorkCard]:
        """
        Get all work cards pending review for a business, optionally filtered by site.
        
        Args:
            business_id: The business UUID
            site_id: Optional site UUID to filter by
            
        Returns:
            List of WorkCard instances with NEEDS_REVIEW status
        """
        query = self.session.query(WorkCard).filter_by(
            review_status='NEEDS_REVIEW',
            business_id=business_id
        )
        
        if site_id:
            query = query.filter_by(site_id=site_id)
        
        return query.all()
    
    def get_all_for_business(self, business_id: UUID) -> List[WorkCard]:
        """
        Get all work cards for a business.
        
        Args:
            business_id: The business UUID
            
        Returns:
            List of WorkCard instances
        """
        return self.session.query(WorkCard).filter_by(business_id=business_id).all()
    
    def approve_card(self, card_id: UUID, user_id: UUID, business_id: UUID) -> Optional[WorkCard]:
        """
        Approve a work card.
        
        Args:
            card_id: The work card's UUID
            user_id: The approving user's UUID
            business_id: The business UUID to verify ownership
            
        Returns:
            The approved WorkCard instance or None if not found
        """
        card = self.session.query(WorkCard).filter_by(
            id=card_id,
            business_id=business_id
        ).first()
        if not card:
            return None
        
        card.review_status = 'APPROVED'
        card.approved_by_user_id = user_id
        card.approved_at = utc_now()
        self.session.commit()
        
        return card
    
    def bulk_approve(self, card_ids: List[UUID], user_id: UUID, business_id: UUID) -> int:
        """
        Approve multiple work cards.
        
        Args:
            card_ids: List of work card UUIDs to approve
            user_id: The approving user's UUID
            business_id: The business UUID to verify ownership
            
        Returns:
            Number of cards approved
        """
        count = self.session.query(WorkCard).filter(
            WorkCard.id.in_(card_ids),
            WorkCard.business_id == business_id
        ).update({
            'review_status': 'APPROVED',
            'approved_by_user_id': user_id,
            'approved_at': utc_now()
        }, synchronize_session=False)
        
        self.session.commit()
        return count
    
    def get_with_extraction(self, card_id: UUID, business_id: UUID) -> Optional[WorkCard]:
        """
        Get a work card with its extraction eagerly loaded.
        
        Args:
            card_id: The work card's UUID
            business_id: The business UUID to verify ownership
            
        Returns:
            WorkCard instance with extraction loaded or None if not found
        """
        return self.session.query(WorkCard).options(
            joinedload(WorkCard.extraction)
        ).filter_by(id=card_id, business_id=business_id).first()
    
    def get_with_day_entries(self, card_id: UUID, business_id: UUID) -> Optional[WorkCard]:
        """
        Get a work card with its day entries eagerly loaded.
        
        Args:
            card_id: The work card's UUID
            business_id: The business UUID to verify ownership
            
        Returns:
            WorkCard instance with day_entries loaded or None if not found
        """
        return self.session.query(WorkCard).options(
            joinedload(WorkCard.day_entries)
        ).filter_by(id=card_id, business_id=business_id).first()
    
    def get_with_all_relations(self, card_id: UUID, business_id: UUID) -> Optional[WorkCard]:
        """
        Get a work card with all its relations eagerly loaded.
        
        Args:
            card_id: The work card's UUID
            business_id: The business UUID to verify ownership
            
        Returns:
            WorkCard instance with all relations loaded or None if not found
        """
        return self.session.query(WorkCard).options(
            joinedload(WorkCard.extraction),
            joinedload(WorkCard.day_entries),
            joinedload(WorkCard.files)
        ).filter_by(id=card_id, business_id=business_id).first()

    def get_for_export(
        self,
        site_id: UUID,
        month: date,
        business_id: UUID,
        statuses: Optional[List[str]] = None,
        employee_ids: Optional[List[UUID]] = None,
        include_unassigned: bool = True,
        include_employee: bool = True,
        include_day_entries: bool = False
    ) -> List[WorkCard]:
        """
        Get work cards for export with optional filters and eager loading.
        """
        query = self.session.query(WorkCard).options(
            joinedload(WorkCard.files)
        )

        if include_employee:
            query = query.options(joinedload(WorkCard.employee))
        if include_day_entries:
            query = query.options(joinedload(WorkCard.day_entries))

        query = query.filter(
            WorkCard.site_id == site_id,
            WorkCard.processing_month == month,
            WorkCard.business_id == business_id
        )

        if statuses:
            query = query.filter(WorkCard.review_status.in_(statuses))

        if employee_ids:
            if include_unassigned:
                query = query.filter(
                    or_(WorkCard.employee_id.in_(employee_ids), WorkCard.employee_id.is_(None))
                )
            else:
                query = query.filter(WorkCard.employee_id.in_(employee_ids))
        else:
            if not include_unassigned:
                query = query.filter(WorkCard.employee_id.isnot(None))

        return query.order_by(WorkCard.created_at.desc()).all()
    
    def update_review_status(self, card_id: UUID, status: str, business_id: UUID) -> Optional[WorkCard]:
        """
        Update the review status of a work card.
        
        Args:
            card_id: The work card's UUID
            status: The new review status
            business_id: The business UUID to verify ownership
            
        Returns:
            The updated WorkCard instance or None if not found
        """
        card = self.session.query(WorkCard).filter_by(
            id=card_id,
            business_id=business_id
        ).first()
        if not card:
            return None
        
        card.review_status = status
        self.session.commit()
        
        return card
