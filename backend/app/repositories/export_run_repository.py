from typing import Optional, List
from uuid import UUID
from datetime import date
from .base import BaseRepository
from ..models.audit import ExportRun


class ExportRunRepository(BaseRepository[ExportRun]):
    """Repository for ExportRun model operations."""
    
    def __init__(self):
        super().__init__(ExportRun)
    
    def get_by_month(self, month: date, site_id: Optional[UUID] = None) -> List[ExportRun]:
        """
        Get all export runs for a specific month, optionally filtered by site.
        
        Args:
            month: The processing month
            site_id: Optional site UUID to filter by
            
        Returns:
            List of ExportRun instances, ordered by created_at descending
        """
        query = self.session.query(ExportRun).filter_by(processing_month=month)
        
        if site_id:
            query = query.filter_by(site_id=site_id)
        
        return query.order_by(ExportRun.created_at.desc()).all()
    
    def get_by_site(self, site_id: UUID) -> List[ExportRun]:
        """
        Get all export runs for a specific site.
        
        Args:
            site_id: The site's UUID
            
        Returns:
            List of ExportRun instances, ordered by created_at descending
        """
        return self.session.query(ExportRun).filter_by(
            site_id=site_id
        ).order_by(ExportRun.created_at.desc()).all()
    
    def get_recent(self, limit: int = 10) -> List[ExportRun]:
        """
        Get recent export runs across all sites.
        
        Args:
            limit: Maximum number of runs to return
            
        Returns:
            List of ExportRun instances, ordered by created_at descending
        """
        return self.session.query(ExportRun).order_by(
            ExportRun.created_at.desc()
        ).limit(limit).all()
    
    def get_by_user(self, user_id: UUID) -> List[ExportRun]:
        """
        Get all export runs performed by a specific user.
        
        Args:
            user_id: The user's UUID
            
        Returns:
            List of ExportRun instances, ordered by created_at descending
        """
        return self.session.query(ExportRun).filter_by(
            exported_by_user_id=user_id
        ).order_by(ExportRun.created_at.desc()).all()
    
    def get_latest_for_site_month(self, site_id: UUID, month: date) -> Optional[ExportRun]:
        """
        Get the most recent export run for a site and month.
        
        Args:
            site_id: The site's UUID
            month: The processing month
            
        Returns:
            The most recent ExportRun instance or None if not found
        """
        return self.session.query(ExportRun).filter_by(
            site_id=site_id,
            processing_month=month
        ).order_by(ExportRun.created_at.desc()).first()
