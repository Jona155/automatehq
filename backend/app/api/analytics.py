"""Employee performance analytics API (PRD: Employee Performance Analytics).

Read-only, hours-based endpoints layered on the utilization metric. Role-scoped:
  - FIELD_MANAGER    -> only sites where Site.field_manager_id == them
  - ADMIN / OPERATOR_MANAGER -> all sites in their business

Distinct from /api/dashboard/summary (counts-only). See analytics_service for
the aggregation logic and period resolution.
"""

import logging

from flask import Blueprint, g, request

from ..auth_utils import token_required, role_required
from ..extensions import db
from ..models.sites import Site
from ..services.analytics_service import (
    resolve_period,
    build_site_scorecards,
    build_site_detail,
    build_employee_detail,
)
from .utils import api_response

logger = logging.getLogger(__name__)

analytics_bp = Blueprint('analytics', __name__, url_prefix='/api/analytics')

_ANALYTICS_ROLES = ('ADMIN', 'OPERATOR_MANAGER', 'FIELD_MANAGER')


def _scoped_site_query():
    """Base Site query for the caller: tenant-scoped, active, and field-manager
    limited to their own sites."""
    q = Site.query.filter(Site.business_id == g.business_id, Site.is_active.is_(True))
    if g.current_user.role == 'FIELD_MANAGER':
        q = q.filter(Site.field_manager_id == g.current_user.id)
    return q


@analytics_bp.route('/site-scorecard', methods=['GET'])
@token_required
@role_required(*_ANALYTICS_ROLES)
def get_site_scorecard():
    """Per-site utilization scorecard, sorted worst-first. Query: period."""
    try:
        period = request.args.get('period', 'prev_month')
        bust = request.args.get('bust_cache') == '1'
        months = resolve_period(period)

        allowed_site_ids = [row[0] for row in _scoped_site_query().with_entities(Site.id).all()]
        data = build_site_scorecards(g.business_id, months, allowed_site_ids, bust=bust)

        cache_hit = data.pop('any_cache_hit', False)
        return api_response(
            data={'period': period, 'months': [m.isoformat() for m in months], **data},
            meta={'cached': cache_hit},
        )
    except Exception:
        logger.exception('site-scorecard failed')
        return api_response(status_code=500, message='Failed to build site scorecard', error='Internal Server Error')


@analytics_bp.route('/sites/<uuid:site_id>', methods=['GET'])
@token_required
@role_required(*_ANALYTICS_ROLES)
def get_site_detail(site_id):
    """Employee leaderboard + site-health for one site. Query: period.

    Authorization: a field manager may only query a site they own; anyone else's
    request for a site outside their business is a 404 (same as ownership miss).
    """
    try:
        site = db.session.query(Site).filter(
            Site.id == site_id,
            Site.business_id == g.business_id,
        ).first()
        if not site or (g.current_user.role == 'FIELD_MANAGER' and site.field_manager_id != g.current_user.id):
            return api_response(status_code=404, message='Site not found', error='Not Found')

        period = request.args.get('period', 'prev_month')
        bust = request.args.get('bust_cache') == '1'
        months = resolve_period(period)

        data = build_site_detail(g.business_id, months, site_id, bust=bust)
        cache_hit = data.pop('any_cache_hit', False)
        return api_response(
            data={'period': period, 'months': [m.isoformat() for m in months], **data},
            meta={'cached': cache_hit},
        )
    except Exception:
        logger.exception('site-detail failed')
        return api_response(status_code=500, message='Failed to build site detail', error='Internal Server Error')


@analytics_bp.route('/sites/<uuid:site_id>/employees/<uuid:employee_id>', methods=['GET'])
@token_required
@role_required(*_ANALYTICS_ROLES)
def get_employee_detail(site_id, employee_id):
    """One employee's detail (gauge vs target, site & company averages, trend).

    Same site authorization as site-detail; additionally 404s if the employee
    isn't a member of the site in the period (so a field manager can't probe
    employees outside their sites).
    """
    try:
        site = db.session.query(Site).filter(
            Site.id == site_id,
            Site.business_id == g.business_id,
        ).first()
        if not site or (g.current_user.role == 'FIELD_MANAGER' and site.field_manager_id != g.current_user.id):
            return api_response(status_code=404, message='Site not found', error='Not Found')

        period = request.args.get('period', 'prev_month')
        bust = request.args.get('bust_cache') == '1'
        months = resolve_period(period)

        data = build_employee_detail(g.business_id, months, site_id, employee_id, bust=bust)
        if data is None:
            return api_response(status_code=404, message='Employee not found at this site', error='Not Found')
        cache_hit = data.pop('any_cache_hit', False)
        return api_response(
            data={'period': period, 'months': [m.isoformat() for m in months], **data},
            meta={'cached': cache_hit},
        )
    except Exception:
        logger.exception('employee-detail failed')
        return api_response(status_code=500, message='Failed to build employee detail', error='Internal Server Error')
