import traceback

from flask import g, request

from ..auth_utils import token_required
from .sites import sites_bp, repo, logger, hours_matrix_service
from .utils import api_response, model_to_dict


@sites_bp.route('/<uuid:site_id>/employee-upload-status', methods=['GET'])
@token_required
def get_employee_upload_status(site_id):
    site = repo.get_by_id(site_id)
    if not site or site.business_id != g.business_id:
        return api_response(status_code=404, message='Site not found', error='Not Found')

    processing_month = request.args.get('processing_month')
    if not processing_month:
        return api_response(status_code=400, message='processing_month is required', error='Bad Request')

    try:
        result = hours_matrix_service.get_employee_upload_status(site_id, g.business_id, processing_month)
        return api_response(data=[
            {'employee': model_to_dict(entry['employee']), 'status': entry['status'], 'work_card_id': entry['work_card_id']}
            for entry in result
        ])
    except ValueError as e:
        return api_response(status_code=400, message='Invalid date format. Use YYYY-MM-DD', error=str(e))
    except Exception as e:
        logger.exception(f'Failed to get employee upload status for site {site_id}')
        traceback.print_exc()
        return api_response(status_code=500, message='Failed to get employee upload status', error=str(e))


@sites_bp.route('/<uuid:site_id>/matrix', methods=['GET'])
@token_required
def get_hours_matrix(site_id):
    site = repo.get_by_id(site_id)
    if not site or site.business_id != g.business_id:
        return api_response(status_code=404, message='Site not found', error='Not Found')

    processing_month = request.args.get('processing_month')
    if not processing_month:
        return api_response(status_code=400, message='processing_month is required', error='Bad Request')

    approved_only = request.args.get('approved_only', 'true').lower() == 'true'
    include_inactive = request.args.get('include_inactive', 'false').lower() == 'true'

    try:
        employees, matrix, status_map, _ = hours_matrix_service.load_hours_matrix(
            site_id, g.business_id, processing_month, approved_only, include_inactive
        )
        return api_response(data={
            'employees': [model_to_dict(emp) for emp in employees],
            'matrix': matrix,
            'status_map': status_map,
        })
    except ValueError as e:
        return api_response(status_code=400, message='Invalid date format. Use YYYY-MM-DD', error=str(e))
    except Exception as e:
        logger.exception(f'Failed to get hours matrix for site {site_id}')
        traceback.print_exc()
        return api_response(status_code=500, message='Failed to get hours matrix', error=str(e))
