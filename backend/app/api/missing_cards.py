"""
Missing work-cards API.

Pivotable view of employees still missing work cards for a month (by field
manager or by site), plus per-manager Excel export and WhatsApp delivery,
and a one-click broadcast that sends every field manager their own report.
"""
import logging
from datetime import datetime, date

from flask import Blueprint, g, request, send_file
from uuid import UUID

from ..auth_utils import token_required, role_required
from ..extensions import db
from ..models.business import Business
from ..models.users import User
from .utils import api_response
from ..services import missing_cards_service as mcs
from ..services.whatsapp_listener_client import (
    WhatsAppAuthError,
    WhatsAppListenerClient,
    WhatsAppListenerError,
    WhatsAppNotConnectedError,
    WhatsAppNumberNotRegisteredError,
    WhatsAppPayloadTooLargeError,
)

logger = logging.getLogger(__name__)

missing_cards_bp = Blueprint('missing_cards', __name__, url_prefix='/api/missing-cards')

XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'


def _parse_month(raw):
    """Parse YYYY-MM or YYYY-MM-DD into a month-start date, or (None, error)."""
    if not raw:
        return None, "month parameter is required"
    try:
        if len(raw) == 7:
            parsed = datetime.strptime(raw, "%Y-%m").date()
        else:
            parsed = datetime.strptime(raw, "%Y-%m-%d").date()
        return date(parsed.year, parsed.month, 1), None
    except ValueError:
        return None, "Invalid month format, use YYYY-MM or YYYY-MM-DD"


@missing_cards_bp.route('', methods=['GET'])
@token_required
@role_required('ADMIN')
def get_missing_cards():
    """Pivoted missing-cards data.

    Query params: month=YYYY-MM[-DD] (required), group_by=field_manager|site.
    """
    month, err = _parse_month(request.args.get('month'))
    if err:
        return api_response(status_code=400, message=err, error="Bad Request")

    group_by = request.args.get('group_by', 'field_manager')
    if group_by not in ('field_manager', 'site'):
        return api_response(status_code=400, message="group_by must be field_manager or site", error="Bad Request")

    try:
        rows = mcs.compute_missing(g.business_id, month)
        summary = mcs._bucket_counts(rows)
        gaps = [r for r in rows if r['status'] != mcs.STATUS_COMPLETE]
        summary['sites_with_gaps'] = len({r['site_id'] for r in gaps})
        summary['managers_with_gaps'] = len({r['field_manager_id'] for r in gaps if r['field_manager_id']})

        if group_by == 'site':
            groups = mcs.group_by_site(rows)
        else:
            groups = mcs.group_by_field_manager(rows)

        return api_response(data={
            "month": month.isoformat(),
            "group_by": group_by,
            "summary": summary,
            "groups": groups,
        })
    except Exception as e:
        logger.exception("Failed to compute missing cards")
        return api_response(status_code=500, message="Failed to compute missing cards", error=str(e))


def _manager_rows(business_id, month, user_id):
    """(manager, gap_rows) for a field manager, or (None, None) if not found."""
    manager = db.session.query(User).filter(
        User.id == user_id, User.business_id == business_id
    ).first()
    if not manager:
        return None, None
    rows = mcs.compute_missing(business_id, month)
    gap_rows = [
        r for r in rows
        if r['field_manager_id'] == str(user_id) and r['status'] != mcs.STATUS_COMPLETE
    ]
    return manager, gap_rows


@missing_cards_bp.route('/managers/<uuid:user_id>/export', methods=['GET'])
@token_required
@role_required('ADMIN')
def export_manager_report(user_id):
    """Download the missing-cards XLSX for one field manager."""
    month, err = _parse_month(request.args.get('month'))
    if err:
        return api_response(status_code=400, message=err, error="Bad Request")

    manager, rows = _manager_rows(g.business_id, month, user_id)
    if manager is None:
        return api_response(status_code=404, message="Field manager not found", error="Not Found")

    output = mcs.generate_missing_cards_xlsx(manager.full_name or 'מנהל שטח', rows, month)
    filename = f"missing_cards_{user_id}_{month.strftime('%Y-%m')}.xlsx"
    return send_file(
        output,
        mimetype=XLSX_MIME,
        as_attachment=True,
        download_name=filename,
    )


@missing_cards_bp.route('/export', methods=['GET'])
@token_required
@role_required('ADMIN')
def export_company_report():
    """Download a single missing-cards XLSX covering the entire company."""
    month, err = _parse_month(request.args.get('month'))
    if err:
        return api_response(status_code=400, message=err, error="Bad Request")

    rows = mcs.compute_missing(g.business_id, month)
    gap_rows = [r for r in rows if r['status'] != mcs.STATUS_COMPLETE]
    output = mcs.generate_missing_cards_xlsx(
        'כל החברה', gap_rows, month, include_manager_column=True
    )
    filename = f"missing_cards_all_{month.strftime('%Y-%m')}.xlsx"
    return send_file(
        output,
        mimetype=XLSX_MIME,
        as_attachment=True,
        download_name=filename,
    )


def _build_caption(business, manager_name, month, rows):
    business_name = business.name if business else ''
    month_label = month.strftime('%Y-%m')
    return (
        f"שלום {manager_name or ''},\n"
        f"מצורף דוח כרטיסי עבודה חסרים עבור חודש {month_label} ({len(rows)} עובדים).\n"
        f"נא לוודא שכל העובדים מגישים את שני כרטיסי העבודה החודשיים.\n"
        f"בברכה,\n"
        f"{business_name}"
    )


def _send_manager_document(client, business, manager, month, rows):
    """Generate + send one manager's report. Raises WhatsApp* on failure."""
    chat_id = mcs.normalize_phone_to_whatsapp(manager.phone_number)
    if not chat_id:
        raise ValueError("no_phone")
    output = mcs.generate_missing_cards_xlsx(manager.full_name or 'מנהל שטח', rows, month)
    month_label = month.strftime('%Y-%m')
    filename = f"כרטיסים חסרים - {manager.full_name or 'מנהל שטח'} - {month_label}.xlsx"
    client.send_document(
        chat_id=chat_id,
        file_bytes=output.read(),
        filename=filename,
        caption=_build_caption(business, manager.full_name, month, rows),
        mimetype=XLSX_MIME,
    )


@missing_cards_bp.route('/managers/<uuid:user_id>/whatsapp', methods=['POST'])
@token_required
@role_required('ADMIN')
def send_manager_whatsapp(user_id):
    """Send one field manager their missing-cards XLSX over WhatsApp."""
    data = request.get_json() or {}
    month, err = _parse_month(data.get('processing_month') or data.get('month'))
    if err:
        return api_response(status_code=400, message=err, error="Bad Request")

    manager, rows = _manager_rows(g.business_id, month, user_id)
    if manager is None:
        return api_response(status_code=404, message="Field manager not found", error="Not Found")
    if not manager.phone_number:
        return api_response(status_code=400, message="לא הוגדר מספר טלפון למנהל השטח", error="No phone")
    if not rows:
        return api_response(status_code=400, message="אין עובדים חסרים למנהל זה", error="Nothing to send")

    client = WhatsAppListenerClient.from_env()
    if client is None:
        return api_response(status_code=503, message="שירות הוואטסאפ לא מוגדר", error="WA_LISTENER_URL is not set")

    business = db.session.query(Business).filter(Business.id == g.business_id).first()
    try:
        _send_manager_document(client, business, manager, month, rows)
    except ValueError:
        return api_response(status_code=400, message="מספר טלפון לא תקין", error="Invalid phone")
    except WhatsAppNumberNotRegisteredError:
        return api_response(status_code=404, message="המספר אינו רשום בוואטסאפ", error="Not on WhatsApp")
    except WhatsAppNotConnectedError:
        return api_response(status_code=503, message="שירות הוואטסאפ אינו מחובר כרגע", error="Not connected")
    except WhatsAppPayloadTooLargeError:
        return api_response(status_code=413, message="הקובץ גדול מדי לשליחה בוואטסאפ", error="Too large")
    except WhatsAppAuthError as e:
        logger.error(f"WhatsApp auth error: {e}")
        return api_response(status_code=500, message="שגיאת הזדהות מול שירות הוואטסאפ", error=str(e))
    except WhatsAppListenerError as e:
        logger.exception(f"WhatsApp error sending missing cards for manager {user_id}")
        return api_response(status_code=502, message="שגיאה בשליחת הוואטסאפ", error=str(e))

    return api_response(data={"status": "sent", "manager_id": str(user_id), "employee_count": len(rows)},
                        message="הדוח נשלח בוואטסאפ בהצלחה")


@missing_cards_bp.route('/whatsapp/broadcast', methods=['POST'])
@token_required
@role_required('ADMIN')
def broadcast_whatsapp():
    """Send every field manager with missing employees their own XLSX report.

    Continues past per-manager failures and reports a per-manager breakdown.
    """
    data = request.get_json() or {}
    month, err = _parse_month(data.get('processing_month') or data.get('month'))
    if err:
        return api_response(status_code=400, message=err, error="Bad Request")

    client = WhatsAppListenerClient.from_env()
    if client is None:
        return api_response(status_code=503, message="שירות הוואטסאפ לא מוגדר", error="WA_LISTENER_URL is not set")

    business = db.session.query(Business).filter(Business.id == g.business_id).first()
    rows = mcs.compute_missing(g.business_id, month)
    groups = mcs.group_by_field_manager(rows)

    sent, skipped, failed = [], [], []
    for grp in groups:
        manager_id = grp['field_manager_id']
        manager_name = grp['manager_name']
        gap_rows = grp['employees']
        if manager_id is None:
            skipped.append({"manager_id": None, "manager_name": manager_name, "reason": "no_manager"})
            continue
        if not grp.get('manager_phone'):
            skipped.append({"manager_id": manager_id, "manager_name": manager_name, "reason": "no_phone"})
            continue
        if not gap_rows:
            skipped.append({"manager_id": manager_id, "manager_name": manager_name, "reason": "no_missing"})
            continue

        manager = db.session.query(User).filter(
            User.id == UUID(manager_id), User.business_id == g.business_id
        ).first()
        if not manager:
            skipped.append({"manager_id": manager_id, "manager_name": manager_name, "reason": "not_found"})
            continue

        try:
            _send_manager_document(client, business, manager, month, gap_rows)
            sent.append({"manager_id": manager_id, "manager_name": manager_name, "employee_count": len(gap_rows)})
        except ValueError:
            skipped.append({"manager_id": manager_id, "manager_name": manager_name, "reason": "invalid_phone"})
        except WhatsAppListenerError as e:
            logger.warning(f"Broadcast: failed to send to manager {manager_id}: {e}")
            failed.append({"manager_id": manager_id, "manager_name": manager_name, "error": str(e)})
        except Exception as e:  # noqa: BLE001 — never let one manager abort the blast
            logger.exception(f"Broadcast: unexpected error for manager {manager_id}")
            failed.append({"manager_id": manager_id, "manager_name": manager_name, "error": str(e)})

    return api_response(
        data={"sent": sent, "skipped": skipped, "failed": failed},
        message=f"נשלחו {len(sent)} דוחות, {len(skipped)} דולגו, {len(failed)} נכשלו",
    )
