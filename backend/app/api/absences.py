"""
Absences API.

Per-month list of employees who missed Sunday–Friday workdays (sick leave or
days with no value), with per-month settings (days to ignore), per-employee
days to ignore (e.g. before the employee started) and per-month employee
exclusions.

Role scoping mirrors missing-cards:
  - Reading (list, settings, export) is open to every authenticated user; a
    FIELD_MANAGER is narrowed to the sites they are responsible for.
  - Writes (settings, employee days, exclusions) are ADMIN-only.
"""
import logging
from uuid import UUID

from flask import Blueprint, g, request, send_file

from ..auth_utils import token_required, role_required
from ..extensions import db
from ..models.absences import AbsenceEmployeeDaySettings, AbsenceEmployeeExclusion, AbsenceMonthSettings
from ..models.sites import Employee
from ..services import absences_service as svc
from .missing_cards import _parse_month, _scoped_site_ids, XLSX_MIME
from .utils import api_response

logger = logging.getLogger(__name__)

absences_bp = Blueprint('absences', __name__, url_prefix='/api/absences')


def _scoped_absences(month):
    # An empty list (field manager with no sites) filters to nothing — the
    # service only widens to the whole business for None.
    return svc.compute_absences(g.business_id, month, site_ids=_scoped_site_ids())


@absences_bp.route('', methods=['GET'])
@token_required
def get_absences():
    """Query params: month=YYYY-MM[-DD] (required)."""
    month, err = _parse_month(request.args.get('month'))
    if err:
        return api_response(status_code=400, message=err, error="Bad Request")
    try:
        return api_response(data=_scoped_absences(month))
    except Exception as e:
        logger.exception("Failed to compute absences")
        return api_response(status_code=500, message="Failed to compute absences", error=str(e))


@absences_bp.route('/settings', methods=['GET'])
@token_required
def get_settings():
    month, err = _parse_month(request.args.get('month'))
    if err:
        return api_response(status_code=400, message=err, error="Bad Request")
    return api_response(data={
        'month': month.isoformat(),
        'ignored_days': svc.get_ignored_days(g.business_id, month),
    })


@absences_bp.route('/settings', methods=['PUT'])
@token_required
@role_required('ADMIN')
def save_settings():
    """Body: {processing_month: YYYY-MM[-DD], ignored_days: [int]}"""
    data = request.get_json() or {}
    month, err = _parse_month(data.get('processing_month') or data.get('month'))
    if err:
        return api_response(status_code=400, message=err, error="Bad Request")

    raw_days = data.get('ignored_days', [])
    if not isinstance(raw_days, list):
        return api_response(status_code=400, message="ignored_days must be a list", error="Bad Request")
    try:
        ignored_days = svc.normalize_ignored_days(month, raw_days)
    except ValueError as e:
        return api_response(status_code=400, message=str(e), error="Bad Request")

    try:
        settings = svc.get_settings(g.business_id, month)
        if settings is None:
            settings = AbsenceMonthSettings(business_id=g.business_id, processing_month=month)
            db.session.add(settings)
        settings.ignored_days = ignored_days
        settings.updated_by_user_id = g.current_user.id
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        logger.exception("Failed to save absence settings")
        return api_response(status_code=500, message="שגיאה בשמירת הגדרות החודש", error=str(e))

    return api_response(
        data={'month': month.isoformat(), 'ignored_days': ignored_days},
        message="הגדרות החודש נשמרו",
    )


@absences_bp.route('/employee-days', methods=['PUT'])
@token_required
@role_required('ADMIN')
def save_employee_days():
    """Set employees' own ignored days for a month. Every listed employee gets
    exactly ``ignored_days`` (replacing what they had); an empty list clears them.

    Body: {processing_month: YYYY-MM[-DD], employee_ids: [uuid], ignored_days: [int]}
    (a single ``employee_id`` is accepted too).
    """
    data = request.get_json() or {}
    month, err = _parse_month(data.get('processing_month') or data.get('month'))
    if err:
        return api_response(status_code=400, message=err, error="Bad Request")

    raw_ids = data.get('employee_ids')
    if raw_ids is None and data.get('employee_id') is not None:
        raw_ids = [data.get('employee_id')]
    if not isinstance(raw_ids, list) or not raw_ids:
        return api_response(status_code=400, message="employee_ids is required", error="Bad Request")
    try:
        employee_ids = {UUID(str(i)) for i in raw_ids}
    except (ValueError, AttributeError, TypeError):
        return api_response(status_code=400, message="Invalid employee id", error="Bad Request")

    raw_days = data.get('ignored_days', [])
    if not isinstance(raw_days, list):
        return api_response(status_code=400, message="ignored_days must be a list", error="Bad Request")
    try:
        ignored_days = svc.normalize_ignored_days(month, raw_days)
    except ValueError as e:
        return api_response(status_code=400, message=str(e), error="Bad Request")

    valid_ids = {
        r[0] for r in db.session.query(Employee.id).filter(
            Employee.business_id == g.business_id,
            Employee.id.in_(employee_ids),
        )
    }
    if valid_ids != employee_ids:
        return api_response(status_code=404, message="Employee not found", error="Not Found")

    try:
        existing = {
            s.employee_id: s
            for s in db.session.query(AbsenceEmployeeDaySettings).filter(
                AbsenceEmployeeDaySettings.business_id == g.business_id,
                AbsenceEmployeeDaySettings.processing_month == month,
                AbsenceEmployeeDaySettings.employee_id.in_(employee_ids),
            )
        }
        for emp_id in employee_ids:
            settings = existing.get(emp_id)
            if not ignored_days:
                if settings is not None:
                    db.session.delete(settings)
                continue
            if settings is None:
                settings = AbsenceEmployeeDaySettings(
                    business_id=g.business_id, processing_month=month, employee_id=emp_id,
                )
                db.session.add(settings)
            settings.ignored_days = ignored_days
            settings.updated_by_user_id = g.current_user.id
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        logger.exception("Failed to save employee absence days")
        return api_response(status_code=500, message="שגיאה בשמירת ימי העובדים", error=str(e))

    return api_response(
        data={'month': month.isoformat(), 'updated': len(employee_ids), 'ignored_days': ignored_days},
        message="ימי העובדים נשמרו",
    )


@absences_bp.route('/exclusions', methods=['POST'])
@token_required
@role_required('ADMIN')
def set_exclusions():
    """Remove (or restore) employees from a month's absences view.

    Body: {processing_month, employee_ids: [uuid], excluded: bool, reason?: str}
    """
    data = request.get_json() or {}
    month, err = _parse_month(data.get('processing_month') or data.get('month'))
    if err:
        return api_response(status_code=400, message=err, error="Bad Request")

    raw_ids = data.get('employee_ids') or []
    if not isinstance(raw_ids, list) or not raw_ids:
        return api_response(status_code=400, message="employee_ids is required", error="Bad Request")
    try:
        employee_ids = {UUID(str(i)) for i in raw_ids}
    except (ValueError, AttributeError, TypeError):
        return api_response(status_code=400, message="Invalid employee id", error="Bad Request")

    excluded = bool(data.get('excluded', True))
    reason = (data.get('reason') or '').strip() or None

    valid_ids = {
        r[0] for r in db.session.query(Employee.id).filter(
            Employee.business_id == g.business_id,
            Employee.id.in_(employee_ids),
        )
    }
    if valid_ids != employee_ids:
        return api_response(status_code=404, message="Employee not found", error="Not Found")

    try:
        existing = {
            ex.employee_id: ex
            for ex in db.session.query(AbsenceEmployeeExclusion).filter(
                AbsenceEmployeeExclusion.business_id == g.business_id,
                AbsenceEmployeeExclusion.processing_month == month,
                AbsenceEmployeeExclusion.employee_id.in_(employee_ids),
            )
        }
        if excluded:
            for emp_id in employee_ids:
                ex = existing.get(emp_id)
                if ex is None:
                    db.session.add(AbsenceEmployeeExclusion(
                        business_id=g.business_id,
                        processing_month=month,
                        employee_id=emp_id,
                        reason=reason,
                        created_by_user_id=g.current_user.id,
                    ))
                elif reason is not None:
                    ex.reason = reason
        else:
            for ex in existing.values():
                db.session.delete(ex)
        db.session.commit()
    except Exception as e:
        db.session.rollback()
        logger.exception("Failed to update absence exclusions")
        return api_response(status_code=500, message="שגיאה בעדכון הרשימה", error=str(e))

    count = len(employee_ids)
    message = (
        f"{count} עובדים הוסרו מהתצוגה לחודש זה"
        if excluded
        else f"{count} עובדים הוחזרו לתצוגה"
    )
    return api_response(data={'updated': count, 'excluded': excluded}, message=message)


@absences_bp.route('/export', methods=['GET'])
@token_required
def export_absences():
    month, err = _parse_month(request.args.get('month'))
    if err:
        return api_response(status_code=400, message=err, error="Bad Request")

    result = _scoped_absences(month)
    title = (
        g.current_user.full_name or 'מנהל שטח'
        if g.current_user.role == 'FIELD_MANAGER'
        else 'כל החברה'
    )
    output = svc.generate_absences_xlsx(result, month, title)
    return send_file(
        output,
        mimetype=XLSX_MIME,
        as_attachment=True,
        download_name=f"absences_{month.strftime('%Y-%m')}.xlsx",
    )
