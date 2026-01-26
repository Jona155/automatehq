from typing import Optional, List
from uuid import UUID
from sqlalchemy import or_, func
from .base import BaseRepository
from ..models.sites import Employee


class EmployeeRepository(BaseRepository[Employee]):
    """Repository for Employee model operations."""
    
    def __init__(self):
        super().__init__(Employee)
    
    def get_by_site(self, site_id: UUID) -> List[Employee]:
        """
        Get all employees at a specific site.
        
        Args:
            site_id: The site's UUID
            
        Returns:
            List of Employee instances
        """
        return self.session.query(Employee).filter_by(site_id=site_id).all()
    
    def get_by_passport(self, passport_id: str) -> Optional[Employee]:
        """
        Get an employee by passport ID.
        
        Args:
            passport_id: The employee's passport ID
            
        Returns:
            Employee instance or None if not found
        """
        return self.session.query(Employee).filter_by(passport_id=passport_id).first()
    
    def get_by_external_id(self, external_id: str) -> Optional[Employee]:
        """
        Get an employee by external employee ID.
        
        Args:
            external_id: The external employee ID
            
        Returns:
            Employee instance or None if not found
        """
        return self.session.query(Employee).filter_by(external_employee_id=external_id).first()
    
    def get_active_by_site(self, site_id: UUID) -> List[Employee]:
        """
        Get all active employees at a specific site.
        
        Args:
            site_id: The site's UUID
            
        Returns:
            List of active Employee instances
        """
        return self.session.query(Employee).filter_by(
            site_id=site_id, 
            is_active=True
        ).all()
    
    def search_by_name(self, name: str, site_id: Optional[UUID] = None) -> List[Employee]:
        """
        Search employees by name (case-insensitive partial match).
        
        Args:
            name: The name or partial name to search for
            site_id: Optional site ID to filter by
            
        Returns:
            List of matching Employee instances
        """
        query = self.session.query(Employee).filter(
            func.lower(Employee.full_name).contains(name.lower())
        )
        
        if site_id:
            query = query.filter_by(site_id=site_id)
        
        return query.all()
    
    def get_active_employees(self) -> List[Employee]:
        """
        Get all active employees across all sites.
        
        Returns:
            List of active Employee instances
        """
        return self.session.query(Employee).filter_by(is_active=True).all()
    
    def deactivate(self, employee_id: UUID) -> bool:
        """
        Deactivate an employee.
        
        Args:
            employee_id: The UUID of the employee to deactivate
            
        Returns:
            True if deactivated successfully, False if employee not found
        """
        employee = self.get_by_id(employee_id)
        if not employee:
            return False
        
        employee.is_active = False
        self.session.commit()
        return True
    
    def activate(self, employee_id: UUID) -> bool:
        """
        Activate an employee.
        
        Args:
            employee_id: The UUID of the employee to activate
            
        Returns:
            True if activated successfully, False if employee not found
        """
        employee = self.get_by_id(employee_id)
        if not employee:
            return False
        
        employee.is_active = True
        self.session.commit()
        return True
