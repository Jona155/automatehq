"""Site report preview & editing API.

Lets an admin open a site's Summary or Salary report for a month, correct
per-day values, attach report notes and save. A saved value is written into the
employee's work card day entries (see
``services/sites/report_adjustments_service.py``), so the review screen,
analytics, the missing-cards view and every report export show the same data.

Shares the ``/api/sites`` prefix with the sites blueprint.
"""
import logging
from datetime import datetime

from flask import Blueprint, g, request

from ..auth_utils import role_required, token_required
from ..repositories.site_repository import SiteRepository
from ..services.sites import report_adjustments_service as svc
from ..services.sites.report_model import REPORT_TYPES
from .utils import api_response

logger = logging.getLogger(__name__)

site_reports_bp = Blueprint('site_reports', __name__, url_prefix='/api/sites')
site_repo = SiteRepository()


def _disabled_response():
    return api_response(status_code=404, message="Report editor is not enabled", error="Not Found")


def _resolve(site_id, report_type, raw_month):
    """Return (site, month, error_response)."""
    if report_type not in REPORT_TYPES:
        return None, None, api_response(status_code=404, message="Unknown report type", error="Not Found")
    site = site_repo.get_by_id(site_id)
    if not site or site.business_id != g.business_id:
        return None, None, api_response(status_code=404, message="Site not found", error="Not Found")
    if not raw_month:
        return None, None, api_response(status_code=400, message="processing_month is required", error="Bad Request")
    try:
        month = datetime.strptime(raw_month, '%Y-%m-%d').date().replace(day=1)
    except (TypeError, ValueError):
        return None, None, api_response(status_code=400, message="Invalid date format. Use YYYY-MM-DD", error="Bad Request")
    return site, month, None


@site_reports_bp.route('/report-editor/status', methods=['GET'])
@token_required
def report_editor_status():
    return api_response(data={'enabled': svc.is_enabled()})


@site_reports_bp.route('/<uuid:site_id>/reports/<report_type>', methods=['GET'])
@token_required
@role_required('ADMIN')
def get_site_report(site_id, report_type):
    if not svc.is_enabled():
        return _disabled_response()
    site, month, error = _resolve(site_id, report_type, request.args.get('processing_month'))
    if error:
        return error
    try:
        payload = svc.build_report_payload(
            site, month, report_type, g.business_id,
            show_other_site_names=request.args.get('show_other_site_names', 'false').lower() == 'true',
        )
    except FileNotFoundError as e:
        logger.exception("Report template missing for site %s", site_id)
        return api_response(status_code=500, message="תבנית הדוח לא נמצאה", error=str(e))
    except Exception as e:
        logger.exception("Failed to build report preview for site %s", site_id)
        return api_response(status_code=500, message="שגיאה בטעינת הדוח", error=str(e))
    return api_response(data=payload)


@site_reports_bp.route('/<uuid:site_id>/reports/<report_type>', methods=['PUT'])
@token_required
@role_required('ADMIN')
def save_site_report(site_id, report_type):
    if not svc.is_enabled():
        return _disabled_response()
    data = request.get_json(silent=True) or {}
    site, month, error = _resolve(site_id, report_type, data.get('processing_month'))
    if error:
        return error
    base_revision = data.get('base_revision')
    if isinstance(base_revision, bool) or not isinstance(base_revision, int):
        return api_response(status_code=400, message="base_revision is required", error="Bad Request")

    try:
        saved = svc.save_report_changes(
            business_id=g.business_id,
            site=site,
            month=month,
            report_type=report_type,
            base_revision=base_revision,
            cells=data.get('cells') or [],
            notes=data.get('notes') or [],
            user_id=g.current_user.id,
        )
    except svc.ReportConflict as e:
        return api_response(
            status_code=409,
            message="הדוח עודכן על ידי משתמש אחר מאז שנפתח. השינויים שלך לא נשמרו.",
            error="Conflict",
            data={'current_revision': e.current_revision},
        )
    except svc.ReportValidationError as e:
        # Say what actually went wrong: a value changed elsewhere and a day that
        # belongs to another site are not "invalid values" the user mistyped.
        reasons = {item.get('message') for item in e.errors}
        stale = svc.STALE_VALUE_MESSAGE in reasons
        if reasons == {svc.STALE_VALUE_MESSAGE}:
            message = ("ערכים בדוח שונו במקום אחר במערכת מאז שהדוח נפתח. "
                       "דבר לא נשמר — טענו את הגרסה העדכנית ונסו שוב.")
        elif reasons == {svc.OTHER_SITE_DAY_MESSAGE}:
            message = "חלק מהימים רשומים לעובד באתר אחר ולא ניתן לערוך אותם מדוח זה. דבר לא נשמר."
        elif stale:
            message = ("חלק מהערכים שונו במקום אחר במערכת מאז שהדוח נפתח, וחלק אינם תקינים. "
                       "דבר לא נשמר.")
        else:
            message = "חלק מהערכים אינם תקינים. דבר לא נשמר."
        return api_response(
            status_code=422,
            message=message,
            error="Validation Error",
            data={'errors': e.errors, 'stale': stale},
        )
    except Exception as e:
        logger.exception("Failed to save report changes for site %s", site_id)
        return api_response(status_code=500, message="שגיאה בשמירת הדוח", error=str(e))

    try:
        payload = svc.build_report_payload(
            site, month, report_type, g.business_id,
            show_other_site_names=data.get('show_other_site_names') is True,
        )
    except Exception as e:
        logger.exception("Saved, but failed to rebuild report preview for site %s", site_id)
        return api_response(status_code=500, message="השינויים נשמרו אך טעינת הדוח נכשלה", error=str(e))
    # Employees with no work card whose days were just filled got a manual card.
    payload['created_manual_cards'] = saved['created_manual_cards']
    return api_response(data=payload, message="השינויים נשמרו")
