"""
Employee matching module - matches extracted passport ID to employee records.

Matching Strategy:
1. Exact normalized passport ID match
2. Alternate normalized passport candidate match
3. Optional fuzzy passport match with OCR-aware edit distance
4. Optional high-confidence name+site fallback (non-exact)
"""
import logging
import re
import unicodedata
from typing import Optional, Dict, Any, Iterable, List, Tuple
from uuid import UUID

from passport_normalization import normalize_passport, normalize_passport_candidates

logger = logging.getLogger("extraction_worker.matcher")

IDENTITY_REASON_FORMAT_ONLY_DIFF = "FORMAT_ONLY_DIFF"
IDENTITY_REASON_VALUE_DIFF = "VALUE_DIFF"
IDENTITY_REASON_NO_EXTRACTED_ID = "NO_EXTRACTED_ID"
IDENTITY_REASON_NO_ASSIGNED_ID = "NO_ASSIGNED_ID"

OCR_CONFUSION_SUBSTITUTION_COST = {
    frozenset(("M", "N")): 0.5,
    frozenset(("O", "0")): 0.5,
    frozenset(("I", "1")): 0.5,
    frozenset(("S", "5")): 0.5,
    frozenset(("B", "8")): 0.5,
}


def _coerce_passport_candidate_values(passport_candidates: Optional[Iterable[Any]]) -> List[str]:
    coerced: List[str] = []
    for candidate in passport_candidates or []:
        if candidate is None:
            continue

        if isinstance(candidate, str):
            coerced.append(candidate)
            continue

        if isinstance(candidate, dict):
            normalized_value = candidate.get("normalized")
            raw_value = candidate.get("raw")
            if isinstance(normalized_value, str):
                coerced.append(normalized_value)
                continue
            if isinstance(raw_value, str):
                coerced.append(raw_value)
                continue

        coerced.append(str(candidate))
    return coerced


def _substitution_cost(left: str, right: str) -> float:
    if left == right:
        return 0.0
    return OCR_CONFUSION_SUBSTITUTION_COST.get(frozenset((left, right)), 1.0)


def _weighted_damerau_levenshtein(left: str, right: str) -> float:
    if left == right:
        return 0.0

    left_len = len(left)
    right_len = len(right)
    if left_len == 0:
        return float(right_len)
    if right_len == 0:
        return float(left_len)

    dp = [[0.0] * (right_len + 1) for _ in range(left_len + 1)]
    for i in range(left_len + 1):
        dp[i][0] = float(i)
    for j in range(right_len + 1):
        dp[0][j] = float(j)

    for i in range(1, left_len + 1):
        for j in range(1, right_len + 1):
            cost_sub = _substitution_cost(left[i - 1], right[j - 1])
            dp[i][j] = min(
                dp[i - 1][j] + 1.0,
                dp[i][j - 1] + 1.0,
                dp[i - 1][j - 1] + cost_sub,
            )
            if i > 1 and j > 1 and left[i - 1] == right[j - 2] and left[i - 2] == right[j - 1]:
                dp[i][j] = min(dp[i][j], dp[i - 2][j - 2] + 0.5)

    return round(dp[left_len][right_len], 3)


def _name_normalize(value: Optional[str]) -> str:
    if not value:
        return ""
    cleaned = unicodedata.normalize("NFKD", value)
    cleaned = "".join(ch for ch in cleaned if not unicodedata.combining(ch))
    cleaned = cleaned.lower()
    cleaned = re.sub(r"[^a-z0-9]+", "", cleaned)
    return cleaned


def _name_similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    distance = _weighted_damerau_levenshtein(left.upper(), right.upper())
    base = max(len(left), len(right))
    if base == 0:
        return 0.0
    return max(0.0, round(1.0 - (distance / float(base)), 4))


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
            "employee_id": employee.id,
            "employee_name": employee.full_name,
            "normalized_passport_id": normalized_value,
        }

    return None


def _get_active_employees_for_scope(
    business_id: UUID,
    employee_repo: Any,
    site_id: Optional[UUID],
) -> Tuple[List[Any], List[Any]]:
    scoped = []
    business_pool = []

    if site_id:
        get_active_by_site = getattr(employee_repo, "get_active_by_site", None)
        if callable(get_active_by_site):
            scoped = get_active_by_site(site_id=site_id, business_id=business_id) or []

    get_active_employees = getattr(employee_repo, "get_active_employees", None)
    if callable(get_active_employees):
        business_pool = get_active_employees(business_id=business_id) or []
    else:
        get_all = getattr(employee_repo, "get_all_for_business", None)
        if callable(get_all):
            business_pool = get_all(business_id=business_id) or []

    if scoped:
        scoped_ids = {employee.id for employee in scoped}
        business_pool = [employee for employee in business_pool if employee.id not in scoped_ids]

    return scoped, business_pool


def _build_fuzzy_passport_candidates(
    normalized_values: Iterable[str],
    business_id: UUID,
    employee_repo: Any,
    site_id: Optional[UUID],
    max_suggestions: int = 5,
) -> Tuple[List[Dict[str, Any]], Optional[Dict[str, Any]]]:
    normalized_inputs = [value for value in normalize_passport_candidates(normalized_values) if value]
    if not normalized_inputs:
        return [], None

    scoped_employees, business_employees = _get_active_employees_for_scope(
        business_id=business_id,
        employee_repo=employee_repo,
        site_id=site_id,
    )

    all_candidates = []
    seen_ids = set()
    scoped_ids = {employee.id for employee in scoped_employees}
    for employee in scoped_employees + business_employees:
        if employee.id in seen_ids:
            continue
        seen_ids.add(employee.id)
        normalized_emp_passport = normalize_passport(getattr(employee, "passport_id", None))
        if not normalized_emp_passport:
            continue
        all_candidates.append({
            "employee": employee,
            "normalized_passport": normalized_emp_passport,
            "scope": "site" if employee.id in scoped_ids else "business",
        })

    scored = []
    for extracted in normalized_inputs:
        for candidate in all_candidates:
            distance = _weighted_damerau_levenshtein(extracted, candidate["normalized_passport"])
            scored.append({
                "employee_id": candidate["employee"].id,
                "employee_name": candidate["employee"].full_name,
                "employee_passport": candidate["normalized_passport"],
                "input_passport": extracted,
                "distance": distance,
                "scope": candidate["scope"],
            })

    if not scored:
        return [], None

    scored.sort(
        key=lambda item: (
            item["distance"],
            0 if item["scope"] == "site" else 1,
            item["employee_name"].lower(),
        )
    )

    best = scored[0]
    same_best = [item for item in scored if item["distance"] == best["distance"]]
    second_distance = None
    for item in scored:
        if item["distance"] > best["distance"]:
            second_distance = item["distance"]
            break
    margin = (second_distance - best["distance"]) if second_distance is not None else float("inf")

    suggestions = scored[:max_suggestions]
    auto_match = None
    if best["distance"] <= 1.0 and len(same_best) == 1 and margin >= 1.0:
        auto_match = {
            "employee_id": best["employee_id"],
            "employee_name": best["employee_name"],
            "normalized_passport_id": best["employee_passport"],
            "distance": best["distance"],
            "candidate_count": len(scored),
            "decision_reason": "fuzzy_passport_unique_distance_le_1",
            "match_candidates": suggestions,
        }

    return suggestions, auto_match


def match_employee(
    passport_id: Optional[str],
    passport_candidates: Optional[Iterable[str]],
    business_id: UUID,
    employee_repo: Any,
    employee_name: Optional[str] = None,
    site_id: Optional[UUID] = None,
    enable_name_site_fallback: bool = False,
    enable_fuzzy_passport_match: bool = False,
    enable_fuzzy_name_fallback: bool = False,
) -> Optional[Dict[str, Any]]:
    """Attempt matching using normalized passport and optional fallback strategies."""
    normalized_primary = normalize_passport(passport_id if isinstance(passport_id, str) else str(passport_id or ""))
    normalized_candidates = normalize_passport_candidates(
        _coerce_passport_candidate_values(passport_candidates)
    )
    fuzzy_candidates_list: List[Dict[str, Any]] = []

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
                "method": "passport_normalized_exact",
                "confidence": 1.0,
                "is_exact": True,
                "is_fuzzy": False,
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
                "method": "passport_candidate_exact",
                "confidence": 0.95,
                "is_exact": True,
                "is_fuzzy": False,
            }

    if enable_fuzzy_passport_match:
        fuzzy_candidates_list, fuzzy_auto_match = _build_fuzzy_passport_candidates(
            normalized_values=[normalized_primary] + normalized_candidates,
            business_id=business_id,
            employee_repo=employee_repo,
            site_id=site_id,
        )
        if fuzzy_auto_match:
            logger.info(
                "Matched employee '%s' via fuzzy passport distance=%s",
                fuzzy_auto_match["employee_name"],
                fuzzy_auto_match["distance"],
            )
            return {
                **fuzzy_auto_match,
                "method": "passport_fuzzy_unique_distance_le_1",
                "confidence": 0.78,
                "is_exact": False,
                "is_fuzzy": True,
            }

    if enable_name_site_fallback:
        name_site_match = match_employee_by_name(
            employee_name=employee_name,
            business_id=business_id,
            site_id=site_id,
            employee_repo=employee_repo,
            enable_fuzzy_name_fallback=enable_fuzzy_name_fallback,
        )
        if name_site_match:
            response = {
                **name_site_match,
                "method": "name_site_high_confidence_fallback",
                "confidence": name_site_match.get("confidence", 0.85),
                "is_exact": False,
                "is_fuzzy": bool(name_site_match.get("is_fuzzy")),
                "decision_reason": name_site_match.get("decision_reason") or name_site_match.get("method"),
            }
            if name_site_match.get("match_candidates") or fuzzy_candidates_list:
                response["match_candidates"] = name_site_match.get("match_candidates") or fuzzy_candidates_list
            return response

    logger.info("No employee match found for normalized passport/name inputs")
    if fuzzy_candidates_list:
        return {
            "employee_id": None,
            "employee_name": None,
            "normalized_passport_id": None,
            "method": "no_match_with_fuzzy_candidates",
            "confidence": 0.0,
            "is_exact": False,
            "is_fuzzy": True,
            "decision_reason": "fuzzy_passport_candidates_ambiguous_or_distance_gt_1",
            "match_candidates": fuzzy_candidates_list,
            "candidate_count": len(fuzzy_candidates_list),
            "distance": fuzzy_candidates_list[0].get("distance"),
        }
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
    employee_repo: Any,  # EmployeeRepository
    enable_fuzzy_name_fallback: bool = False,
) -> Optional[Dict[str, Any]]:
    """Attempt to match by employee name and optional site (fallback method)."""
    if not employee_name:
        return None

    employee_name = employee_name.strip()
    if not employee_name:
        return None

    logger.info("Attempting to match by name: %s", employee_name)

    matches = employee_repo.search_by_name(
        name=employee_name,
        business_id=business_id,
        site_id=site_id,
    )

    if not matches:
        logger.info("No employees found matching name: %s", employee_name)
        if not enable_fuzzy_name_fallback:
            return None
    else:
        if len(matches) == 1:
            employee = matches[0]
            logger.info("Single name match found: '%s' (ID: %s)", employee.full_name, employee.id)
            return {
                "employee_id": employee.id,
                "employee_name": employee.full_name,
                "method": "name_contains_unique",
                "confidence": 0.85,
                "is_fuzzy": False,
                "decision_reason": "name_contains_unique",
            }

    if matches:
        logger.warning("Multiple employees (%s) match name: %s", len(matches), employee_name)
    else:
        logger.info("Proceeding to fuzzy name fallback for: %s", employee_name)
    if not enable_fuzzy_name_fallback:
        return None

    scoped_employees, business_employees = _get_active_employees_for_scope(
        business_id=business_id,
        employee_repo=employee_repo,
        site_id=site_id,
    )
    all_candidates = scoped_employees + business_employees
    if not all_candidates:
        return None

    scoped_ids = {employee.id for employee in scoped_employees}
    normalized_input = _name_normalize(employee_name)
    scored = []
    for employee in all_candidates:
        normalized_name = _name_normalize(employee.full_name)
        similarity = _name_similarity(normalized_input, normalized_name)
        scored.append({
            "employee_id": employee.id,
            "employee_name": employee.full_name,
            "similarity": similarity,
            "scope": "site" if employee.id in scoped_ids else "business",
        })

    if not scored:
        return None

    scored.sort(
        key=lambda item: (
            -item["similarity"],
            0 if item["scope"] == "site" else 1,
            item["employee_name"].lower(),
        )
    )
    best = scored[0]
    second = scored[1] if len(scored) > 1 else None
    margin = best["similarity"] - (second["similarity"] if second else 0.0)

    if best["similarity"] >= 0.88 and margin >= 0.08:
        logger.info(
            "Fuzzy name match found: '%s' similarity=%.3f",
            best["employee_name"],
            best["similarity"],
        )
        return {
            "employee_id": best["employee_id"],
            "employee_name": best["employee_name"],
            "method": "name_fuzzy_unique",
            "confidence": round(min(0.9, max(0.6, best["similarity"])), 3),
            "is_fuzzy": True,
            "decision_reason": "name_fuzzy_unique_threshold",
            "match_candidates": scored[:3],
        }

    return None


def diagnose_identity_mismatch(
    assigned_passport_id: Optional[str],
    extracted_passport_id: Optional[str],
) -> Dict[str, Any]:
    """Compare assigned/extracted IDs by normalized value and return frontend-safe diagnostics."""
    assigned_raw = (assigned_passport_id or "").strip()
    extracted_raw = (extracted_passport_id or "").strip()

    if not extracted_raw:
        return {
            "identity_mismatch": False,
            "identity_reason": IDENTITY_REASON_NO_EXTRACTED_ID,
        }

    if not assigned_raw:
        return {
            "identity_mismatch": False,
            "identity_reason": IDENTITY_REASON_NO_ASSIGNED_ID,
        }

    assigned_normalized = normalize_passport(assigned_raw)
    extracted_normalized = normalize_passport(extracted_raw)
    if assigned_normalized and extracted_normalized and assigned_normalized == extracted_normalized:
        if assigned_raw != extracted_raw:
            return {
                "identity_mismatch": False,
                "identity_reason": IDENTITY_REASON_FORMAT_ONLY_DIFF,
            }

        return {
            "identity_mismatch": False,
            "identity_reason": None,
        }

    return {
        "identity_mismatch": True,
        "identity_reason": IDENTITY_REASON_VALUE_DIFF,
    }
