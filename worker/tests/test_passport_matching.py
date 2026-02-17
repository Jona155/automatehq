import sys
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from passport_normalization import normalize_passport, normalize_passport_candidates
from matcher import (
    match_employee,
    diagnose_identity_mismatch,
    IDENTITY_REASON_FORMAT_ONLY_DIFF,
    IDENTITY_REASON_NO_ASSIGNED_ID,
    IDENTITY_REASON_NO_EXTRACTED_ID,
    IDENTITY_REASON_VALUE_DIFF,
)


class FakeEmployeeRepo:
    def __init__(self, by_passport=None, name_matches=None, active_by_site=None, active_by_business=None):
        self.by_passport = by_passport or {}
        self.name_matches = name_matches or {}
        self.active_by_site = active_by_site or {}
        self.active_by_business = active_by_business or []

    def get_by_passport(self, passport_id, business_id=None):
        return self.by_passport.get(passport_id)

    def search_by_name(self, name, business_id, site_id=None):
        return self.name_matches.get((name, site_id), [])

    def get_active_by_site(self, site_id, business_id):
        return self.active_by_site.get(site_id, [])

    def get_active_employees(self, business_id):
        return self.active_by_business


def _employee(name, passport_id=None):
    return SimpleNamespace(id=uuid4(), full_name=name, passport_id=passport_id)


def test_normalize_passport_rules():
    assert normalize_passport(' n-12/34,56 ') == 'N123456'
    assert normalize_passport('ab123456') is None
    assert normalize_passport('123') is None


def test_normalize_candidates_deduplicates():
    assert normalize_passport_candidates(['N-12345', ' N12345 ', 'X']) == ['N12345']


def test_match_order_primary_before_candidates_and_name_fallback():
    business_id = uuid4()
    site_id = uuid4()
    primary_employee = _employee('Primary Match')
    candidate_employee = _employee('Candidate Match')
    name_employee = _employee('Name Match')

    repo = FakeEmployeeRepo(
        by_passport={
            'N123456': primary_employee,
            'N999999': candidate_employee,
        },
        name_matches={('John Doe', site_id): [name_employee]},
    )

    result = match_employee(
        passport_id='n-123456',
        passport_candidates=['n-999999'],
        business_id=business_id,
        employee_repo=repo,
        employee_name='John Doe',
        site_id=site_id,
        enable_name_site_fallback=True,
    )

    assert result['employee_id'] == primary_employee.id
    assert result['method'] == 'passport_normalized_exact'
    assert result['is_exact'] is True


def test_match_uses_candidates_then_name_site_fallback():
    business_id = uuid4()
    site_id = uuid4()
    candidate_employee = _employee('Candidate Match')
    name_employee = _employee('Name Match')

    repo = FakeEmployeeRepo(
        by_passport={'N999999': candidate_employee},
        name_matches={('John Doe', site_id): [name_employee]},
    )

    result = match_employee(
        passport_id='BAD',
        passport_candidates=['n-999999'],
        business_id=business_id,
        employee_repo=repo,
        employee_name='John Doe',
        site_id=site_id,
        enable_name_site_fallback=True,
    )

    assert result['employee_id'] == candidate_employee.id
    assert result['method'] == 'passport_candidate_exact'
    assert result['is_exact'] is True

    repo = FakeEmployeeRepo(name_matches={('John Doe', site_id): [name_employee]})
    fallback_result = match_employee(
        passport_id='BAD',
        passport_candidates=['also-bad'],
        business_id=business_id,
        employee_repo=repo,
        employee_name='John Doe',
        site_id=site_id,
        enable_name_site_fallback=True,
    )

    assert fallback_result['employee_id'] == name_employee.id
    assert fallback_result['method'] == 'name_site_high_confidence_fallback'
    assert fallback_result['is_exact'] is False


def test_identity_diagnostics_distinguishes_format_and_value_diff():
    format_only = diagnose_identity_mismatch(
        assigned_passport_id=' N-123456 ',
        extracted_passport_id='N123456',
    )
    assert format_only['identity_mismatch'] is False
    assert format_only['identity_reason'] == IDENTITY_REASON_FORMAT_ONLY_DIFF

    value_diff = diagnose_identity_mismatch(
        assigned_passport_id='N123456',
        extracted_passport_id='N999999',
    )
    assert value_diff['identity_mismatch'] is True
    assert value_diff['identity_reason'] == IDENTITY_REASON_VALUE_DIFF


def test_identity_diagnostics_handles_missing_values():
    no_extracted = diagnose_identity_mismatch(
        assigned_passport_id='N123456',
        extracted_passport_id=None,
    )
    assert no_extracted['identity_mismatch'] is False
    assert no_extracted['identity_reason'] == IDENTITY_REASON_NO_EXTRACTED_ID

    no_assigned = diagnose_identity_mismatch(
        assigned_passport_id=None,
        extracted_passport_id='N123456',
    )
    assert no_assigned['identity_mismatch'] is False
    assert no_assigned['identity_reason'] == IDENTITY_REASON_NO_ASSIGNED_ID


def test_fuzzy_passport_unique_distance_one_auto_matches():
    business_id = uuid4()
    site_id = uuid4()
    fuzzy_employee = _employee('Fuzzy Match', passport_id='N123456')
    repo = FakeEmployeeRepo(
        active_by_site={site_id: [fuzzy_employee]},
        active_by_business=[fuzzy_employee],
    )

    result = match_employee(
        passport_id='M123456',
        passport_candidates=[],
        business_id=business_id,
        employee_repo=repo,
        site_id=site_id,
        enable_fuzzy_passport_match=True,
    )

    assert result['employee_id'] == fuzzy_employee.id
    assert result['method'] == 'passport_fuzzy_unique_distance_le_1'
    assert result['is_exact'] is False
    assert result['is_fuzzy'] is True
    assert result['distance'] <= 1.0


def test_fuzzy_passport_ambiguous_does_not_auto_assign():
    business_id = uuid4()
    site_id = uuid4()
    employee_a = _employee('Employee A', passport_id='M123456')
    employee_b = _employee('Employee B', passport_id='N123456')
    repo = FakeEmployeeRepo(
        active_by_site={site_id: [employee_a, employee_b]},
        active_by_business=[employee_a, employee_b],
    )

    result = match_employee(
        passport_id='N123456',
        passport_candidates=['M123456'],
        business_id=business_id,
        employee_repo=repo,
        site_id=site_id,
        enable_fuzzy_passport_match=True,
    )

    # Exact match path should still be preferred.
    assert result['employee_id'] == employee_b.id
    assert result['method'] == 'passport_normalized_exact'

    no_exact_repo = FakeEmployeeRepo(
        active_by_site={site_id: [employee_a, employee_b]},
        active_by_business=[employee_a, employee_b],
    )
    no_exact = match_employee(
        passport_id='A123456',
        passport_candidates=[],
        business_id=business_id,
        employee_repo=no_exact_repo,
        site_id=site_id,
        enable_fuzzy_passport_match=True,
    )
    assert no_exact['employee_id'] is None
    assert no_exact['method'] == 'no_match_with_fuzzy_candidates'
