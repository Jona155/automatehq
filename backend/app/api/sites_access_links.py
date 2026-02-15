import os
import traceback
import uuid
from datetime import datetime

from flask import g, request

from ..auth_utils import token_required
from .sites import sites_bp, repo, employee_repo, access_repo, logger, access_link_service
from .utils import api_response, model_to_dict


@sites_bp.route('/<uuid:site_id>/access-link', methods=['POST'])
@token_required
def create_access_link(site_id):
    data = request.get_json() or {}
    employee_id = data.get('employee_id')
    processing_month = data.get('processing_month')
    if not employee_id or not processing_month:
        return api_response(status_code=400, message='employee_id and processing_month are required', error='Bad Request')

    site = repo.get_by_id(site_id)
    if not site or site.business_id != g.business_id:
        return api_response(status_code=404, message='Site not found', error='Not Found')

    employee = employee_repo.get_by_id(employee_id)
    if not employee or employee.business_id != g.business_id or str(employee.site_id) != str(site_id):
        return api_response(status_code=404, message='Employee not found for this site', error='Not Found')
    if not employee.is_active:
        return api_response(status_code=400, message='Employee is not active', error='Bad Request')

    try:
        month = datetime.strptime(processing_month, '%Y-%m-%d').date()
        access_request, url = access_link_service.create_access_request(
            business_id=g.business_id,
            site_id=site_id,
            employee_id=employee_id,
            processing_month=month,
            user_id=g.current_user.id,
        )
    except ValueError as e:
        return api_response(status_code=400, message='Invalid date format. Use YYYY-MM-DD', error=str(e))
    except RuntimeError as e:
        return api_response(status_code=500, message='Failed to generate access token', error=str(e))

    response_data = model_to_dict(access_request)
    response_data['url'] = url
    response_data['employee_name'] = employee.full_name
    return api_response(data=response_data, message='Access link created', status_code=201)


@sites_bp.route('/<uuid:site_id>/access-links', methods=['GET'])
@token_required
def list_access_links(site_id):
    site = repo.get_by_id(site_id)
    if not site or site.business_id != g.business_id:
        return api_response(status_code=404, message='Site not found', error='Not Found')

    links = access_repo.list_active_for_site(site_id, g.business_id)
    data = []
    for link in links:
        item = model_to_dict(link)
        employee = employee_repo.get_by_id(link.employee_id)
        item['employee_name'] = employee.full_name if employee else ''
        item['url'] = access_link_service.build_access_link_url(link.token)
        data.append(item)
    return api_response(data=data)


@sites_bp.route('/<uuid:site_id>/access-link/<uuid:request_id>/whatsapp', methods=['POST'])
@token_required
def send_whatsapp_link(site_id, request_id):
    site = repo.get_by_id(site_id)
    if not site or site.business_id != g.business_id:
        return api_response(status_code=404, message='Site not found', error='Not Found')

    access_request = access_repo.get_by_id(request_id)
    if not access_request or access_request.business_id != g.business_id:
        return api_response(status_code=404, message='Access link not found', error='Not Found')

    employee = employee_repo.get_by_id(access_request.employee_id)
    if not employee or not employee.phone_number:
        return api_response(status_code=400, message='Employee has no phone number', error='Bad Request')

    from_number = os.environ.get('TWILIO_WHATSAPP_NUMBER')
    if not from_number:
        return api_response(status_code=500, message='Server configuration error', error='Twilio config missing')

    try:
        access_link_service.send_whatsapp(employee=employee, access_request=access_request, from_number=from_number)
        return api_response(message='WhatsApp sent successfully')
    except ValueError as e:
        return api_response(status_code=400, message=str(e), error='Bad Request')
    except Exception as e:
        logger.exception(f'Twilio error for request {request_id}')
        return api_response(status_code=500, message='Failed to send WhatsApp message', error=str(e))


@sites_bp.route('/access-links/whatsapp-batch', methods=['POST'])
@token_required
def send_whatsapp_links_batch():
    payload = request.get_json() or {}
    site_ids = payload.get('site_ids') or []
    processing_month = payload.get('processing_month')

    if not site_ids or not isinstance(site_ids, list):
        return api_response(status_code=400, message='site_ids must be a non-empty list', error='Bad Request')
    if not processing_month:
        return api_response(status_code=400, message='processing_month is required', error='Bad Request')

    try:
        month = datetime.strptime(processing_month, '%Y-%m-%d').date()
    except ValueError as e:
        return api_response(status_code=400, message='Invalid date format. Use YYYY-MM-DD', error=str(e))

    from_number = os.environ.get('TWILIO_WHATSAPP_NUMBER')
    if not from_number:
        return api_response(status_code=500, message='Server configuration error', error='Twilio config missing')

    sent_count = failed_count = skipped_count = 0
    results = []

    for site_id_str in site_ids:
        try:
            site_uuid = uuid.UUID(str(site_id_str))
        except ValueError:
            skipped_count += 1
            results.append({'site_id': str(site_id_str), 'status': 'skipped', 'reason': 'Invalid site_id format'})
            continue

        site = repo.get_by_id(site_uuid)
        if not site or site.business_id != g.business_id:
            skipped_count += 1
            results.append({'site_id': str(site_id_str), 'status': 'skipped', 'reason': 'Site not found'})
            continue

        if not site.responsible_employee_id:
            skipped_count += 1
            results.append({'site_id': str(site_id_str), 'site_name': site.site_name, 'status': 'skipped', 'reason': 'No responsible employee'})
            continue

        employee = employee_repo.get_by_id(site.responsible_employee_id)
        if not employee or employee.business_id != g.business_id or str(employee.site_id) != str(site.id):
            skipped_count += 1
            results.append({'site_id': str(site_id_str), 'site_name': site.site_name, 'status': 'skipped', 'reason': 'Responsible employee not found for site'})
            continue
        if not employee.is_active:
            skipped_count += 1
            results.append({'site_id': str(site_id_str), 'site_name': site.site_name, 'employee_id': str(employee.id), 'employee_name': employee.full_name, 'status': 'skipped', 'reason': 'Responsible employee is not active'})
            continue
        if not employee.phone_number:
            skipped_count += 1
            results.append({'site_id': str(site_id_str), 'site_name': site.site_name, 'employee_id': str(employee.id), 'employee_name': employee.full_name, 'status': 'skipped', 'reason': 'Employee has no phone number'})
            continue

        try:
            access_request, _ = access_link_service.create_access_request(
                business_id=g.business_id,
                site_id=site.id,
                employee_id=employee.id,
                processing_month=month,
                user_id=g.current_user.id,
            )
            access_link_service.send_whatsapp(employee=employee, access_request=access_request, from_number=from_number)
            sent_count += 1
            results.append({'site_id': str(site_id_str), 'site_name': site.site_name, 'employee_id': str(employee.id), 'employee_name': employee.full_name, 'request_id': str(access_request.id), 'status': 'sent'})
        except ValueError as e:
            skipped_count += 1
            results.append({'site_id': str(site_id_str), 'site_name': site.site_name, 'employee_id': str(employee.id), 'employee_name': employee.full_name, 'status': 'skipped', 'reason': str(e)})
        except Exception as e:
            logger.exception(f'Twilio error for site {site.id}')
            failed_count += 1
            results.append({'site_id': str(site_id_str), 'site_name': site.site_name, 'employee_id': str(employee.id), 'employee_name': employee.full_name, 'status': 'failed', 'reason': str(e)})

    return api_response(data={
        'total_requested': len(site_ids),
        'processing_month': processing_month,
        'sent_count': sent_count,
        'failed_count': failed_count,
        'skipped_count': skipped_count,
        'results': results,
    }, message='Batch WhatsApp processed')


@sites_bp.route('/<uuid:site_id>/access-link/<uuid:request_id>/revoke', methods=['POST'])
@token_required
def revoke_access_link(site_id, request_id):
    site = repo.get_by_id(site_id)
    if not site or site.business_id != g.business_id:
        return api_response(status_code=404, message='Site not found', error='Not Found')

    access_request = access_repo.get_by_id(request_id)
    if not access_request or access_request.business_id != g.business_id or str(access_request.site_id) != str(site_id):
        return api_response(status_code=404, message='Access link not found', error='Not Found')

    access_repo.revoke(request_id)
    return api_response(message='Access link revoked')
