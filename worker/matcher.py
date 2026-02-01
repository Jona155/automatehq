"""
Employee matching module — matches extracted passport ID to employee records.

Matching Strategy (per project requirements):
1. Primary: Exact passport ID match
2. Fallback: Leave unassigned (admin assigns in UI)
"""
import logging
from typing import Optional, Dict, Any
from uuid import UUID

logger = logging.getLogger('extraction_worker.matcher')


def match_employee_by_passport(
    passport_id: Optional[str],
    business_id: UUID,
    employee_repo: Any  # EmployeeRepository
) -> Optional[Dict[str, Any]]:
    """
    Match extracted passport ID to an employee in the business.
    
    Args:
        passport_id: Extracted passport/ID number from work card
        business_id: Business UUID for tenant scoping
        employee_repo: EmployeeRepository instance
        
    Returns:
        Dict with match result:
        - employee_id: Matched employee UUID
        - method: How the match was made ('passport_exact')
        - confidence: Match confidence (1.0 for exact match)
        
        Returns None if no match found
    """
    if not passport_id:
        logger.debug("No passport ID provided, skipping match")
        return None
    
    # Clean up passport ID (remove whitespace, normalize)
    passport_id = passport_id.strip()
    
    if not passport_id:
        logger.debug("Empty passport ID after cleanup, skipping match")
        return None
    
    logger.info(f"Attempting to match passport ID: {passport_id}")
    
    # Try exact passport match within the business
    employee = employee_repo.get_by_passport(passport_id, business_id=business_id)
    
    if employee:
        logger.info(f"Matched employee '{employee.full_name}' (ID: {employee.id})")
        return {
            'employee_id': employee.id,
            'employee_name': employee.full_name,
            'method': 'passport_exact',
            'confidence': 1.0,
        }
    
    # No match found
    logger.info(f"No employee found with passport ID: {passport_id}")
    return None


def match_employee_by_name(
    employee_name: Optional[str],
    business_id: UUID,
    site_id: Optional[UUID],
    employee_repo: Any  # EmployeeRepository
) -> Optional[Dict[str, Any]]:
    """
    Attempt to match by employee name (fallback method, lower confidence).
    
    Note: This is a secondary matching method and is not currently used
    in the main pipeline. Passport matching is preferred.
    
    Args:
        employee_name: Extracted employee name from work card
        business_id: Business UUID for tenant scoping
        site_id: Optional site UUID to narrow search
        employee_repo: EmployeeRepository instance
        
    Returns:
        Dict with match result or None if no match/ambiguous
    """
    if not employee_name:
        return None
    
    employee_name = employee_name.strip()
    
    if not employee_name:
        return None
    
    logger.info(f"Attempting to match by name: {employee_name}")
    
    # Search for employees by name
    matches = employee_repo.search_by_name(
        name=employee_name,
        business_id=business_id,
        site_id=site_id
    )
    
    if not matches:
        logger.info(f"No employees found matching name: {employee_name}")
        return None
    
    if len(matches) == 1:
        employee = matches[0]
        logger.info(f"Single name match found: '{employee.full_name}' (ID: {employee.id})")
        return {
            'employee_id': employee.id,
            'employee_name': employee.full_name,
            'method': 'name_exact',
            'confidence': 0.8,  # Lower confidence for name matching
        }
    
    # Multiple matches - too ambiguous
    logger.warning(f"Multiple employees ({len(matches)}) match name: {employee_name}")
    return None
