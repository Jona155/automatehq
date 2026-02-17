import sys
from pathlib import Path
from types import SimpleNamespace
from uuid import uuid4

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from passport_normalization import normalize_passport, normalize_passport_candidates
from matcher import match_employee


class FakeEmployeeRepo:
    def __init__(self, by_passport=None, name_matches=None):
        self.by_passport = by_passport or {}
        self.name_matches = name_matches or {}

    def get_by_passport(self, passport_id, business_id=None):
        return self.by_passport.get(passport_id)

    def search_by_name(self, name, business_id, site_id=None):
        return self.name_matches.get((name, site_id), [])


def _employee(name):
    return SimpleNamespace(id=uuid4(), full_name=name)


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
