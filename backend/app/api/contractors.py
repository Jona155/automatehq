import re
import uuid

from flask import Blueprint, g, request
from sqlalchemy.exc import IntegrityError

from ..auth_utils import role_required, token_required
from ..extensions import db
from ..models.contractors import Contractor
from ..models.sites import Site
from ..repositories.contractor_repository import ContractorRepository
from .utils import api_response, model_to_dict


contractors_bp = Blueprint('contractors', __name__, url_prefix='/api/contractors')
repo = ContractorRepository()

EMAIL_REGEX = re.compile(r'^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$')
IL_COUNTRY_CODE = '972'
EDITABLE_FIELDS = {'name', 'email', 'phone_number', 'address', 'is_active'}


def _normalize_phone(raw):
    if raw is None:
        return None, None
    if not isinstance(raw, str):
        return None, 'phone_number must be a string'
    trimmed = raw.strip()
    if not trimmed:
        return None, None
    has_plus = trimmed.startswith('+')
    has_double_zero = trimmed.startswith('00')
    digits = re.sub(r'\D', '', trimmed)
    if not digits:
        return None, 'Invalid phone number'
    if has_plus:
        pass
    elif has_double_zero:
        digits = digits[2:]
    elif digits.startswith('0'):
        digits = IL_COUNTRY_CODE + digits[1:]
    if not (8 <= len(digits) <= 15):
        return None, 'Invalid phone number'
    return digits, None


def _normalize_payload(data, require_name=False):
    cleaned = {key: data[key] for key in EDITABLE_FIELDS if key in data}

    if require_name or 'name' in cleaned:
        name = cleaned.get('name')
        if not isinstance(name, str) or not name.strip():
            return None, 'Contractor name is required'
        cleaned['name'] = name.strip()

    if 'email' in cleaned:
        email = cleaned.get('email')
        if email is None or (isinstance(email, str) and not email.strip()):
            cleaned['email'] = None
        elif not isinstance(email, str) or not EMAIL_REGEX.match(email.strip()):
            return None, 'Invalid email address'
        else:
            cleaned['email'] = email.strip().lower()

    if 'phone_number' in cleaned:
        phone, error = _normalize_phone(cleaned.get('phone_number'))
        if error:
            return None, error
        cleaned['phone_number'] = phone

    if 'address' in cleaned:
        address = cleaned.get('address')
        if address is None or (isinstance(address, str) and not address.strip()):
            cleaned['address'] = None
        elif not isinstance(address, str):
            return None, 'address must be a string'
        else:
            cleaned['address'] = address.strip()

    if 'is_active' in cleaned and not isinstance(cleaned['is_active'], bool):
        return None, 'is_active must be a boolean'

    return cleaned, None


def _parse_site_ids(raw_site_ids):
    if raw_site_ids is None:
        return None, None
    if not isinstance(raw_site_ids, list):
        return None, 'site_ids must be a list'
    parsed = []
    seen = set()
    for raw in raw_site_ids:
        try:
            site_id = uuid.UUID(str(raw))
        except (ValueError, TypeError, AttributeError):
            return None, 'Invalid site_id format'
        if site_id not in seen:
            seen.add(site_id)
            parsed.append(site_id)
    return parsed, None


def _contractor_dict(contractor, employee_count=0):
    data = model_to_dict(contractor)
    sites = sorted(contractor.sites, key=lambda site: (site.site_name or '').lower())
    data['site_count'] = len(sites)
    data['employee_count'] = employee_count
    data['sites'] = [
        {
            'id': str(site.id),
            'site_name': site.site_name,
            'site_code': site.site_code,
            'is_active': site.is_active,
        }
        for site in sites
    ]
    return data


def _resolve_sites(site_ids):
    if not site_ids:
        return [], None
    sites = Site.query.filter(
        Site.id.in_(site_ids),
        Site.business_id == g.business_id,
    ).all()
    if len(sites) != len(site_ids):
        return None, 'One or more sites were not found for this business'
    return sites, None


def _reassignment_conflicts(sites, contractor_id):
    conflicts = []
    contractor_names = {
        str(item.id): item.name
        for item in Contractor.query.filter(
            Contractor.id.in_({site.contractor_id for site in sites if site.contractor_id}),
            Contractor.business_id == g.business_id,
        ).all()
    }
    for site in sites:
        if site.contractor_id and site.contractor_id != contractor_id:
            conflicts.append({
                'site_id': str(site.id),
                'site_name': site.site_name,
                'contractor_id': str(site.contractor_id),
                'contractor_name': contractor_names.get(str(site.contractor_id)),
            })
    return conflicts


def _apply_site_assignments(contractor, site_ids, confirm_reassignment):
    sites, error = _resolve_sites(site_ids)
    if error:
        return None, api_response(status_code=400, message=error, error='Bad Request')
    if sites and not contractor.is_active:
        return None, api_response(
            status_code=400,
            message='Inactive contractors cannot be assigned to sites',
            error='Bad Request',
        )
    conflicts = _reassignment_conflicts(sites, contractor.id)
    if conflicts and not confirm_reassignment:
        return None, api_response(
            data={'conflicts': conflicts},
            status_code=409,
            message='One or more sites are assigned to another contractor',
            error='Conflict',
        )

    selected_ids = {site.id for site in sites}
    for site in Site.query.filter(
        Site.business_id == g.business_id,
        Site.contractor_id == contractor.id,
    ).all():
        if site.id not in selected_ids:
            site.contractor_id = None
    for site in sites:
        site.contractor_id = contractor.id
    return sites, None


@contractors_bp.route('', methods=['GET'])
@token_required
def get_contractors():
    only_active = request.args.get('active', 'false').lower() == 'true'
    contractors = (
        repo.get_active_for_business(g.business_id)
        if only_active
        else repo.get_all_for_business(g.business_id)
    )
    employee_counts = repo.get_active_employee_counts(
        g.business_id,
        [contractor.id for contractor in contractors],
    )
    return api_response(data=[
        _contractor_dict(contractor, employee_counts.get(contractor.id, 0))
        for contractor in contractors
    ])


@contractors_bp.route('/<uuid:contractor_id>', methods=['GET'])
@token_required
def get_contractor(contractor_id):
    contractor = repo.get_by_id(contractor_id)
    if not contractor or contractor.business_id != g.business_id:
        return api_response(status_code=404, message='Contractor not found', error='Not Found')
    employee_count = repo.get_active_employee_counts(
        g.business_id,
        [contractor.id],
    ).get(contractor.id, 0)
    return api_response(data=_contractor_dict(contractor, employee_count))


@contractors_bp.route('', methods=['POST'])
@token_required
@role_required('ADMIN')
def create_contractor():
    data = request.get_json()
    if not isinstance(data, dict):
        return api_response(status_code=400, message='No data provided', error='Bad Request')

    cleaned, error = _normalize_payload(data, require_name=True)
    if error:
        return api_response(status_code=400, message=error, error='Bad Request')
    site_ids, error = _parse_site_ids(data.get('site_ids'))
    if error:
        return api_response(status_code=400, message=error, error='Bad Request')
    if repo.get_by_name_for_business(cleaned['name'], g.business_id):
        return api_response(
            status_code=409,
            message='Contractor with this name already exists',
            error='Conflict',
        )

    contractor = Contractor(business_id=g.business_id, **cleaned)
    db.session.add(contractor)
    db.session.flush()
    if site_ids is not None:
        _, response = _apply_site_assignments(
            contractor,
            site_ids,
            data.get('confirm_reassignment') is True,
        )
        if response:
            db.session.rollback()
            return response
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return api_response(
            status_code=409,
            message='Contractor with this name already exists',
            error='Conflict',
        )
    employee_count = repo.get_active_employee_counts(
        g.business_id,
        [contractor.id],
    ).get(contractor.id, 0)
    return api_response(
        data=_contractor_dict(contractor, employee_count),
        message='Contractor created successfully',
        status_code=201,
    )


@contractors_bp.route('/<uuid:contractor_id>', methods=['PUT'])
@token_required
@role_required('ADMIN')
def update_contractor(contractor_id):
    contractor = repo.get_by_id(contractor_id)
    if not contractor or contractor.business_id != g.business_id:
        return api_response(status_code=404, message='Contractor not found', error='Not Found')
    data = request.get_json()
    if not isinstance(data, dict):
        return api_response(status_code=400, message='No data provided', error='Bad Request')

    cleaned, error = _normalize_payload(data)
    if error:
        return api_response(status_code=400, message=error, error='Bad Request')
    site_ids, error = _parse_site_ids(data.get('site_ids'))
    if error:
        return api_response(status_code=400, message=error, error='Bad Request')

    if 'name' in cleaned:
        existing = repo.get_by_name_for_business(cleaned['name'], g.business_id)
        if existing and existing.id != contractor.id:
            return api_response(
                status_code=409,
                message='Contractor with this name already exists',
                error='Conflict',
            )

    if cleaned.get('is_active') is False and contractor.sites:
        return api_response(
            data={'site_count': len(contractor.sites)},
            status_code=409,
            message='Unassign all sites before deactivating this contractor',
            error='Conflict',
        )

    for key, value in cleaned.items():
        setattr(contractor, key, value)
    if site_ids is not None:
        _, response = _apply_site_assignments(
            contractor,
            site_ids,
            data.get('confirm_reassignment') is True,
        )
        if response:
            db.session.rollback()
            return response
    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return api_response(
            status_code=409,
            message='Contractor with this name already exists',
            error='Conflict',
        )
    employee_count = repo.get_active_employee_counts(
        g.business_id,
        [contractor.id],
    ).get(contractor.id, 0)
    return api_response(
        data=_contractor_dict(contractor, employee_count),
        message='Contractor updated successfully',
    )


@contractors_bp.route('/<uuid:contractor_id>', methods=['DELETE'])
@token_required
@role_required('ADMIN')
def deactivate_contractor(contractor_id):
    contractor = repo.get_by_id(contractor_id)
    if not contractor or contractor.business_id != g.business_id:
        return api_response(status_code=404, message='Contractor not found', error='Not Found')
    if contractor.sites:
        return api_response(
            data={'site_count': len(contractor.sites)},
            status_code=409,
            message='Unassign all sites before deactivating this contractor',
            error='Conflict',
        )
    contractor.is_active = False
    db.session.commit()
    return api_response(
        data=_contractor_dict(contractor, 0),
        message='Contractor deactivated successfully',
    )
