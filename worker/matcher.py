"""
Employee matching module — matches extracted passport ID to employee records.

Matching Strategy:
1. Exact normalized passport ID match
2. Alternate normalized passport candidate match
3. Optional high-confidence name+site fallback (non-exact)
"""
import logging
from typing import Optional, Dict, Any, Iterable
from uuid import UUID

from passport_normalization import normalize_passport, normalize_passport_candidates

logger = logging.getLogger('extraction_worker.matcher')

IDENTITY_REASON_FORMAT_ONLY_DIFF = 'FORMAT_ONLY_DIFF'
IDENTITY_REASON_VALUE_DIFF = 'VALUE_DIFF'
IDENTITY_REASON_NO_EXTRACTED_ID = 'NO_EXTRACTED_ID'
IDENTITY_REASON_NO_ASSIGNED_ID = 'NO_ASSIGNED_ID'


def _match_by_passport_candidates(
    normalized_values: Iterable[str],
    business_id: UUID,
    employee_repo: Any,
) -> Optional[Dict[str, Any]]:
    seen = set()
    for normalized_value in normalized_values:
        if not normalized_value or normalized_value in seen:
            continue
        seen.add(normalized_value)

        employee = employee_repo.get_by_passport(normalized_value, business_id=business_id)
        if not employee:
            continue

        logger.info(
            "Matched employee '%s' (ID: %s) using normalized passport '%s'",
            employee.full_name,
            employee.id,
            normalized_value,
        )
        return {
            'employee_id': employee.id,
            'employee_name': employee.full_name,
            'normalized_passport_id': normalized_value,
        }

    return None


def match_employee(
    passport_id: Optional[str],
    passport_candidates: Optional[Iterable[str]],
    business_id: UUID,
    employee_repo: Any,
    employee_name: Optional[str] = None,
    site_id: Optional[UUID] = None,
    enable_name_site_fallback: bool = False,
) -> Optional[Dict[str, Any]]:
    """Attempt matching using normalized passport and optional name+site fallback."""
    normalized_primary = normalize_passport(passport_id)
    normalized_candidates = normalize_passport_candidates(passport_candidates or [])

    if normalized_primary:
        logger.info("Attempting primary normalized passport match: %s", normalized_primary)
        exact_match = _match_by_passport_candidates(
            [normalized_primary],
            business_id=business_id,
            employee_repo=employee_repo,
        )
        if exact_match:
            return {
                **exact_match,
                'method': 'passport_normalized_exact',
                'confidence': 1.0,
                'is_exact': True,
            }

    if normalized_candidates:
        logger.info("Attempting candidate passport matches (%s candidates)", len(normalized_candidates))
        candidate_match = _match_by_passport_candidates(
            normalized_candidates,
            business_id=business_id,
            employee_repo=employee_repo,
        )
        if candidate_match:
            return {
                **candidate_match,
                'method': 'passport_candidate_exact',
                'confidence': 0.95,
                'is_exact': True,
            }

    if enable_name_site_fallback:
        name_site_match = match_employee_by_name(
            employee_name=employee_name,
            business_id=business_id,
            site_id=site_id,
            employee_repo=employee_repo,
        )
        if name_site_match:
            return {
                **name_site_match,
                'method': 'name_site_high_confidence_fallback',
                'confidence': 0.85,
                'is_exact': False,
            }

    logger.info("No employee match found for normalized passport/name inputs")
    return None


def match_employee_by_passport(
    passport_id: Optional[str],
    business_id: UUID,
    employee_repo: Any,
) -> Optional[Dict[str, Any]]:
    """Backward-compatible wrapper for passport-only matching calls."""
    return match_employee(
        passport_id=passport_id,
        passport_candidates=None,
        business_id=business_id,
        employee_repo=employee_repo,
    )


def match_employee_by_name(
    employee_name: Optional[str],
    business_id: UUID,
    site_id: Optional[UUID],
    employee_repo: Any  # EmployeeRepository
) -> Optional[Dict[str, Any]]:
    """Attempt to match by employee name and optional site (fallback method)."""
    if not employee_name:
        return None

    employee_name = employee_name.strip()

    if not employee_name:
        return None

    logger.info(f"Attempting to match by name: {employee_name}")

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
        }

    logger.warning(f"Multiple employees ({len(matches)}) match name: {employee_name}")
    return None


def diagnose_identity_mismatch(
    assigned_passport_id: Optional[str],
    extracted_passport_id: Optional[str],
) -> Dict[str, Any]:
    """Compare assigned/extracted IDs by normalized value and return frontend-safe diagnostics."""
    assigned_raw = (assigned_passport_id or '').strip()
    extracted_raw = (extracted_passport_id or '').strip()

    if not extracted_raw:
        return {
            'identity_mismatch': False,
            'identity_reason': IDENTITY_REASON_NO_EXTRACTED_ID,
        }

    if not assigned_raw:
        return {
            'identity_mismatch': False,
            'identity_reason': IDENTITY_REASON_NO_ASSIGNED_ID,
        }

    assigned_normalized = normalize_passport(assigned_raw)
    extracted_normalized = normalize_passport(extracted_raw)
    if assigned_normalized and extracted_normalized and assigned_normalized == extracted_normalized:
        if assigned_raw != extracted_raw:
            return {
                'identity_mismatch': False,
                'identity_reason': IDENTITY_REASON_FORMAT_ONLY_DIFF,
            }

        return {
            'identity_mismatch': False,
            'identity_reason': None,
        }

    return {
        'identity_mismatch': True,
        'identity_reason': IDENTITY_REASON_VALUE_DIFF,
    }
