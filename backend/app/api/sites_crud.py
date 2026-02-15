import traceback
import uuid

from flask import g, request

from ..auth_utils import token_required
from .utils import api_response, model_to_dict, models_to_list
from .sites import sites_bp, logger, repo, employee_repo


@sites_bp.route('', methods=['GET'])
@token_required
def get_sites():
    try:
        user_id = getattr(g.current_user, 'id', None)
        business_id = g.business_id
        if user_id:
            sites = repo.get_by_user(user_id)
        else:
            sites = repo.get_all_for_business(business_id)
        return api_response(data=models_to_list(sites))
    except Exception as e:
        logger.exception('Failed to get sites')
        traceback.print_exc()
        return api_response(status_code=500, message='Failed to get sites', error=str(e))


@sites_bp.route('', methods=['POST'])
@token_required
def create_site():
    data = request.get_json()
    if not data:
        return api_response(status_code=400, message='No data provided', error='Bad Request')
    try:
        data['business_id'] = g.business_id
        if not data.get('site_name'):
            return api_response(status_code=400, message='Site name is required', error='Bad Request')
        existing = repo.get_by_name_and_business(data['site_name'], g.business_id)
        if existing:
            return api_response(status_code=409, message='Site with this name already exists', error='Conflict')
        site = repo.create(**data)
        return api_response(data=model_to_dict(site), message='Site created successfully', status_code=201)
    except Exception as e:
        logger.exception('Failed to create site')
        traceback.print_exc()
        return api_response(status_code=500, message='Failed to create site', error=str(e))


@sites_bp.route('/<uuid:site_id>', methods=['GET'])
@token_required
def get_site(site_id):
    try:
        site = repo.get_by_id(site_id)
        if not site or site.business_id != g.business_id:
            return api_response(status_code=404, message='Site not found', error='Not Found')
        return api_response(data=model_to_dict(site))
    except Exception as e:
        logger.exception(f'Failed to get site {site_id}')
        traceback.print_exc()
        return api_response(status_code=500, message='Failed to get site', error=str(e))


@sites_bp.route('/<uuid:site_id>', methods=['PUT'])
@token_required
def update_site(site_id):
    data = request.get_json()
    if not data:
        return api_response(status_code=400, message='No data provided', error='Bad Request')

    try:
        site = repo.get_by_id(site_id)
        if not site or site.business_id != g.business_id:
            return api_response(status_code=404, message='Site not found', error='Not Found')

        data.pop('business_id', None)
        if 'responsible_employee_id' in data:
            responsible_employee_id = data.get('responsible_employee_id')
            if not responsible_employee_id:
                data['responsible_employee_id'] = None
            else:
                try:
                    responsible_employee_uuid = uuid.UUID(str(responsible_employee_id))
                except ValueError:
                    return api_response(status_code=400, message='Invalid responsible_employee_id format', error='Bad Request')

                employee = employee_repo.get_by_id(responsible_employee_uuid)
                if not employee or employee.business_id != g.business_id or str(employee.site_id) != str(site_id):
                    return api_response(status_code=404, message='Responsible employee not found for this site', error='Not Found')
                if not employee.is_active:
                    return api_response(status_code=400, message='Responsible employee is not active', error='Bad Request')
                data['responsible_employee_id'] = responsible_employee_uuid

        updated_site = repo.update(site_id, **data)
        if not updated_site:
            return api_response(status_code=404, message='Site not found', error='Not Found')
        return api_response(data=model_to_dict(updated_site), message='Site updated successfully')
    except Exception as e:
        logger.exception(f'Failed to update site {site_id}')
        traceback.print_exc()
        return api_response(status_code=500, message='Failed to update site', error=str(e))


@sites_bp.route('/<uuid:site_id>', methods=['DELETE'])
@token_required
def delete_site(site_id):
    try:
        site = repo.get_by_id(site_id)
        if not site or site.business_id != g.business_id:
            return api_response(status_code=404, message='Site not found', error='Not Found')
        success = repo.delete(site_id)
        if not success:
            return api_response(status_code=404, message='Site not found', error='Not Found')
        return api_response(message='Site deleted successfully')
    except Exception as e:
        logger.exception(f'Failed to delete site {site_id}')
        traceback.print_exc()
        return api_response(status_code=500, message='Failed to delete site', error=str(e))
