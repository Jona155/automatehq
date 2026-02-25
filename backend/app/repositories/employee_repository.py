from typing import Optional, List
from uuid import UUID
from datetime import date
from sqlalchemy import func, exists
import re
import unicodedata
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

        direct_matches = query.all()
        if direct_matches:
            return direct_matches

        # Fuzzy fallback for OCR one-letter drift in name extraction.
        candidate_query = self.session.query(Employee).filter(
            Employee.business_id == business_id
        )
        if site_id:
            candidate_query = candidate_query.filter_by(site_id=site_id)
        candidates = candidate_query.all()
        if not candidates:
            return []

        def normalize_name(value: str) -> str:
            cleaned = unicodedata.normalize('NFKD', value or '')
            cleaned = ''.join(ch for ch in cleaned if not unicodedata.combining(ch))
            cleaned = cleaned.lower()
            return re.sub(r'[^a-z0-9]+', '', cleaned)

        def weighted_distance(left: str, right: str) -> float:
            if left == right:
                return 0.0
            if not left:
                return float(len(right))
            if not right:
                return float(len(left))
            costs = {
                frozenset(('m', 'n')): 0.5,
                frozenset(('o', '0')): 0.5,
                frozenset(('i', '1')): 0.5,
                frozenset(('s', '5')): 0.5,
                frozenset(('b', '8')): 0.5,
            }
            rows = len(left) + 1
            cols = len(right) + 1
            dp = [[0.0] * cols for _ in range(rows)]
            for i in range(rows):
                dp[i][0] = float(i)
            for j in range(cols):
                dp[0][j] = float(j)
            for i in range(1, rows):
                for j in range(1, cols):
                    sub_cost = costs.get(frozenset((left[i - 1], right[j - 1])), 1.0) if left[i - 1] != right[j - 1] else 0.0
                    dp[i][j] = min(
                        dp[i - 1][j] + 1.0,
                        dp[i][j - 1] + 1.0,
                        dp[i - 1][j - 1] + sub_cost,
                    )
            return dp[-1][-1]

        normalized_input = normalize_name(name)
        if not normalized_input:
            return []

        scored = []
        for candidate in candidates:
            normalized_candidate = normalize_name(candidate.full_name or '')
            if not normalized_candidate:
                continue
            distance = weighted_distance(normalized_input, normalized_candidate)
            length_base = max(len(normalized_input), len(normalized_candidate))
            similarity = 1.0 - (distance / float(length_base)) if length_base else 0.0
            scored.append((candidate, similarity))

        scored.sort(key=lambda item: item[1], reverse=True)
        return [candidate for candidate, similarity in scored if similarity >= 0.82]
    
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
    
    def get_missing_work_card_employees(
        self, business_id: UUID, month: date, site_id: Optional[UUID] = None
    ) -> List[Employee]:
        """
        Get active employees who have no work card for the given month.
        Optionally scoped to a specific site.
        """
        from ..models.work_cards import WorkCard

        subquery = exists().where(
            WorkCard.employee_id == Employee.id,
            WorkCard.processing_month == month,
            WorkCard.business_id == business_id,
        )

        query = self.session.query(Employee).filter(
            Employee.business_id == business_id,
            Employee.is_active == True,
            ~subquery,
        )
        if site_id:
            query = query.filter(Employee.site_id == site_id)

        return query.order_by(Employee.full_name).all()

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
