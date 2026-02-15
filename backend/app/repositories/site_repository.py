from typing import Optional, List, Dict, Any
from uuid import UUID
from sqlalchemy import func
from .base import BaseRepository
from ..models.sites import Site, Employee


class SiteRepository(BaseRepository[Site]):
    """Repository for Site model operations."""
    
    def __init__(self):
        super().__init__(Site)
    
    def get_by_name(self, site_name: str) -> Optional[Site]:
        """
        Get a site by its name.
        
        Args:
            site_name: The site's name
            
        Returns:
            Site instance or None if not found
        """
        return self.session.query(Site).filter_by(site_name=site_name).first()
    
    def get_by_name_and_business(self, site_name: str, business_id: UUID) -> Optional[Site]:
        """
        Get a site by its name within a specific business (tenant-scoped).
        
        Args:
            site_name: The site's name
            business_id: The business ID to scope the query
            
        Returns:
            Site instance or None if not found
        """
        return self.session.query(Site).filter_by(
            site_name=site_name, 
            business_id=business_id
        ).first()
    
    def get_by_code(self, site_code: str) -> Optional[Site]:
        """
        Get a site by its code.
        
        Args:
            site_code: The site's code
            
        Returns:
            Site instance or None if not found
        """
        return self.session.query(Site).filter_by(site_code=site_code).first()
    
    def get_active_sites(self, business_id: Optional[UUID] = None) -> List[Site]:
        """
        Get all active sites, optionally scoped to a business.
        
        Args:
            business_id: Optional business ID to filter by
            
        Returns:
            List of active Site instances
        """
        query = self.session.query(Site).filter_by(is_active=True)
        if business_id:
            query = query.filter_by(business_id=business_id)
        return query.all()

    def get_all_for_business(self, business_id: UUID) -> List[Site]:
        """
        Get all sites for a business.

        Args:
            business_id: The business UUID

        Returns:
            List of Site instances
        """
        return self.session.query(Site).filter_by(business_id=business_id).all()

    def get_by_ids_for_business(self, site_ids: List[UUID], business_id: UUID) -> List[Site]:
        """
        Get sites by IDs for a business in a single query.

        Args:
            site_ids: Site UUIDs to fetch
            business_id: The business UUID

        Returns:
            List of Site instances
        """
        if not site_ids:
            return []

        return self.session.query(Site).filter(
            Site.id.in_(site_ids),
            Site.business_id == business_id
        ).all()
    
    def get_with_employee_count(self, business_id: Optional[UUID] = None) -> List[Dict[str, Any]]:
        """
        Get all sites with their employee counts, optionally scoped to a business.
        
        Args:
            business_id: Optional business ID to filter by
            
        Returns:
            List of dicts with site info and employee_count
        """
        query = self.session.query(
            Site,
            func.count(Employee.id).label('employee_count')
        ).outerjoin(Employee, Site.id == Employee.site_id)\
         .group_by(Site.id)
        
        if business_id:
            query = query.filter(Site.business_id == business_id)
        
        results = query.all()
        
        return [
            {
                'site': site,
                'employee_count': count
            }
            for site, count in results
        ]
    
    def get_active_with_employee_count(self, business_id: Optional[UUID] = None) -> List[Dict[str, Any]]:
        """
        Get all active sites with their active employee counts, optionally scoped to a business.
        
        Args:
            business_id: Optional business ID to filter by
            
        Returns:
            List of dicts with site info and employee_count
        """
        query = self.session.query(
            Site,
            func.count(Employee.id).label('employee_count')
        ).outerjoin(
            Employee, 
            (Site.id == Employee.site_id) & (Employee.is_active == True)
        ).filter(Site.is_active == True)\
         .group_by(Site.id)
        
        if business_id:
            query = query.filter(Site.business_id == business_id)
        
        results = query.all()
        
        return [
            {
                'site': site,
                'employee_count': count
            }
            for site, count in results
        ]
