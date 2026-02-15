from typing import Optional, List
from uuid import UUID
from sqlalchemy import or_, func
from .base import BaseRepository
from ..models.sites import Employee


class EmployeeRepository(BaseRepository[Employee]):
    """Repository for Employee model operations."""
    
    def __init__(self):
        super().__init__(Employee)
    
    def get_by_site(self, site_id: UUID, business_id: UUID) -> List[Employee]:
        """
        Get all employees at a specific site for a business.
        
        Args:
            site_id: The site's UUID
            business_id: The business UUID
            
        Returns:
            List of Employee instances
        """
        return self.session.query(Employee).filter_by(
            site_id=site_id,
            business_id=business_id
        ).all()
    
    def get_by_passport(self, passport_id: str, business_id: Optional[UUID] = None) -> Optional[Employee]:
        """
        Get an employee by passport ID.
        Passport is globally unique, but can optionally verify business ownership.
        
        Args:
            passport_id: The employee's passport ID
            business_id: Optional business_id to verify ownership
            
        Returns:
            Employee instance or None if not found
        """
        query = self.session.query(Employee).filter_by(passport_id=passport_id)
        if business_id:
            query = query.filter_by(business_id=business_id)
        return query.first()

    def get_by_passports(self, passports: List[str], business_id: UUID) -> List[Employee]:
        """
        Get employees by a list of passport IDs scoped to a business.

        Args:
            passports: List of passport IDs
            business_id: The business UUID

        Returns:
            List of Employee instances
        """
        if not passports:
            return []
        return self.session.query(Employee).filter(
            Employee.passport_id.in_(passports),
            Employee.business_id == business_id
        ).all()
    
    def get_by_external_id(self, external_id: str, business_id: UUID) -> Optional[Employee]:
        """
        Get an employee by external employee ID.
        
        Args:
            external_id: The external employee ID
            business_id: The business UUID
            
        Returns:
            Employee instance or None if not found
        """
        return self.session.query(Employee).filter_by(
            external_employee_id=external_id,
            business_id=business_id
        ).first()
    
    def get_active_by_site(self, site_id: UUID, business_id: UUID) -> List[Employee]:
        """
        Get all active employees at a specific site for a business.
        
        Args:
            site_id: The site's UUID
            business_id: The business UUID
            
        Returns:
            List of active Employee instances
        """
        return self.session.query(Employee).filter_by(
            site_id=site_id,
            business_id=business_id,
            is_active=True
        ).all()
    
    def search_by_name(self, name: str, business_id: UUID, site_id: Optional[UUID] = None) -> List[Employee]:
        """
        Search employees by name (case-insensitive partial match).
        
        Args:
            name: The name or partial name to search for
            business_id: The business UUID
            site_id: Optional site ID to filter by
            
        Returns:
            List of matching Employee instances
        """
        query = self.session.query(Employee).filter(
            func.lower(Employee.full_name).contains(name.lower()),
            Employee.business_id == business_id
        )
        
        if site_id:
            query = query.filter_by(site_id=site_id)
        
        return query.all()
    
    def get_active_employees(self, business_id: UUID) -> List[Employee]:
        """
        Get all active employees for a business.
        
        Args:
            business_id: The business UUID
        
        Returns:
            List of active Employee instances
        """
        return self.session.query(Employee).filter_by(
            business_id=business_id,
            is_active=True
        ).all()
    
    def get_all_for_business(self, business_id: UUID) -> List[Employee]:
        """
        Get all employees for a business.
        
        Args:
            business_id: The business UUID
            
        Returns:
            List of Employee instances
        """
        return self.session.query(Employee).filter_by(business_id=business_id).all()
    

    def get_by_ids_for_business(self, employee_ids: List[UUID], business_id: UUID) -> List[Employee]:
        """
        Get employees by IDs scoped to a business in a single query.

        Args:
            employee_ids: Employee UUIDs to fetch
            business_id: The business UUID

        Returns:
            List of Employee instances
        """
        if not employee_ids:
            return []

        return self.session.query(Employee).filter(
            Employee.id.in_(employee_ids),
            Employee.business_id == business_id
        ).all()

    def deactivate(self, employee_id: UUID, business_id: UUID) -> bool:
        """
        Deactivate an employee.
        
        Args:
            employee_id: The UUID of the employee to deactivate
            business_id: The business UUID to verify ownership
            
        Returns:
            True if deactivated successfully, False if employee not found
        """
        employee = self.session.query(Employee).filter_by(
            id=employee_id,
            business_id=business_id
        ).first()
        if not employee:
            return False
        
        employee.is_active = False
        self.session.commit()
        return True
    
    def activate(self, employee_id: UUID, business_id: UUID) -> bool:
        """
        Activate an employee.
        
        Args:
            employee_id: The UUID of the employee to activate
            business_id: The business UUID to verify ownership
            
        Returns:
            True if activated successfully, False if employee not found
        """
        employee = self.session.query(Employee).filter_by(
            id=employee_id,
            business_id=business_id
        ).first()
        if not employee:
            return False
        
        employee.is_active = True
        self.session.commit()
        return True
