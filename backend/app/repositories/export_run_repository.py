from typing import Optional, List
from uuid import UUID
from datetime import date
from .base import BaseRepository
from ..models.audit import ExportRun


class ExportRunRepository(BaseRepository[ExportRun]):
    """Repository for ExportRun model operations."""
    
    def __init__(self):
        super().__init__(ExportRun)
    
    def get_by_month(self, month: date, business_id: UUID, site_id: Optional[UUID] = None) -> List[ExportRun]:
        """
        Get all export runs for a specific month in a business, optionally filtered by site.
        
        Args:
            month: The processing month
            business_id: The business UUID
            site_id: Optional site UUID to filter by
            
        Returns:
            List of ExportRun instances, ordered by created_at descending
        """
        query = self.session.query(ExportRun).filter_by(
            processing_month=month,
            business_id=business_id
        )
        
        if site_id:
            query = query.filter_by(site_id=site_id)
        
        return query.order_by(ExportRun.created_at.desc()).all()
    
    def get_by_site(self, site_id: UUID, business_id: UUID) -> List[ExportRun]:
        """
        Get all export runs for a specific site in a business.
        
        Args:
            site_id: The site's UUID
            business_id: The business UUID
            
        Returns:
            List of ExportRun instances, ordered by created_at descending
        """
        return self.session.query(ExportRun).filter_by(
            site_id=site_id,
            business_id=business_id
        ).order_by(ExportRun.created_at.desc()).all()
    
    def get_recent(self, business_id: UUID, limit: int = 10) -> List[ExportRun]:
        """
        Get recent export runs for a business.
        
        Args:
            business_id: The business UUID
            limit: Maximum number of runs to return
            
        Returns:
            List of ExportRun instances, ordered by created_at descending
        """
        return self.session.query(ExportRun).filter_by(
            business_id=business_id
        ).order_by(ExportRun.created_at.desc()).limit(limit).all()
    
    def get_by_user(self, user_id: UUID, business_id: UUID) -> List[ExportRun]:
        """
        Get all export runs performed by a specific user in a business.
        
        Args:
            user_id: The user's UUID
            business_id: The business UUID
            
        Returns:
            List of ExportRun instances, ordered by created_at descending
        """
        return self.session.query(ExportRun).filter_by(
            exported_by_user_id=user_id,
            business_id=business_id
        ).order_by(ExportRun.created_at.desc()).all()
    
    def get_latest_for_site_month(self, site_id: UUID, month: date, business_id: UUID) -> Optional[ExportRun]:
        """
        Get the most recent export run for a site and month in a business.
        
        Args:
            site_id: The site's UUID
            month: The processing month
            business_id: The business UUID
            
        Returns:
            The most recent ExportRun instance or None if not found
        """
        return self.session.query(ExportRun).filter_by(
            site_id=site_id,
            processing_month=month,
            business_id=business_id
        ).order_by(ExportRun.created_at.desc()).first()
    
    def get_all_for_business(self, business_id: UUID) -> List[ExportRun]:
        """
        Get all export runs for a business.
        
        Args:
            business_id: The business UUID
            
        Returns:
            List of ExportRun instances
        """
        return self.session.query(ExportRun).filter_by(business_id=business_id).all()