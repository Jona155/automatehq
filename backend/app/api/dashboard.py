import os
import logging
from datetime import date, datetime, timezone
from typing import Dict, Any, List, Tuple, Optional

from flask import Blueprint, g, request
from sqlalchemy import func, and_

from ..auth_utils import token_required
from ..extensions import db
from ..models.sites import Site, Employee
from ..models.work_cards import WorkCard
from .utils import api_response

logger = logging.getLogger(__name__)

dashboard_bp = Blueprint('dashboard', __name__, url_prefix='/api/dashboard')

CACHE_TTL_SECONDS = int(os.environ.get('DASHBOARD_CACHE_TTL_SECONDS', 300))
_CACHE: Dict[Tuple[str, str], Dict[str, Any]] = {}


def _month_start(d: date) -> date:
    return date(d.year, d.month, 1)


def _add_months(d: date, months: int) -> date:
    year = d.year + (d.month - 1 + months) // 12
    month = (d.month - 1 + months) % 12 + 1
    return date(year, month, 1)


def _parse_month_param(raw: Optional[str]) -> Optional[date]:
    if not raw:
        return _month_start(datetime.now(timezone.utc).date())
    try:
        if len(raw) == 7:
            parsed = datetime.strptime(raw, "%Y-%m").date()
        else:
            parsed = datetime.strptime(raw, "%Y-%m-%d").date()
        return _month_start(parsed)
    except ValueError:
        return None


def _get_cached(key: Tuple[str, str]) -> Optional[Dict[str, Any]]:
    cached = _CACHE.get(key)
    if not cached:
        return None
    age = (datetime.now(timezone.utc) - cached["ts"]).total_seconds()
    if age > CACHE_TTL_SECONDS:
        _CACHE.pop(key, None)
        return None
    return cached["data"]


def _set_cached(key: Tuple[str, str], data: Dict[str, Any]) -> None:
    _CACHE[key] = {"ts": datetime.now(timezone.utc), "data": data}


@dashboard_bp.route('/summary', methods=['GET'])
@token_required
def get_dashboard_summary():
    """
    Returns a single payload for dashboard metrics/charts to minimize DB round-trips.
    Optional query param: month=YYYY-MM or YYYY-MM-DD (defaults to current month).
    """
    try:
        month_param = request.args.get('month')
        month_start = _parse_month_param(month_param)
        if not month_start:
            return api_response(
                status_code=400,
                message="Invalid month format. Use YYYY-MM or YYYY-MM-DD",
                error="Bad Request"
            )

        business_id = str(g.business_id)
        cache_key = (business_id, month_start.isoformat())
        cached = _get_cached(cache_key)
        if cached:
            return api_response(data=cached, meta={"cached": True, "cache_ttl_seconds": CACHE_TTL_SECONDS})

        # Core counts
        sites_count = db.session.query(func.count(Site.id)).filter(
            Site.business_id == g.business_id,
            Site.is_active.is_(True)
        ).scalar() or 0

        employees_count = db.session.query(func.count(Employee.id)).filter(
            Employee.business_id == g.business_id,
            Employee.is_active.is_(True)
        ).scalar() or 0

        work_cards_count = db.session.query(func.count(WorkCard.id)).filter(
            WorkCard.business_id == g.business_id,
            WorkCard.processing_month == month_start
        ).scalar() or 0

        # Top 5 active sites by active employee counts
        sites_rows = db.session.query(
            Site.id,
            Site.site_name,
            func.count(Employee.id).label("employee_count")
        ).outerjoin(
            Employee,
            and_(
                Employee.site_id == Site.id,
                Employee.business_id == g.business_id,
                Employee.is_active.is_(True)
            )
        ).filter(
            Site.business_id == g.business_id,
            Site.is_active.is_(True)
        ).group_by(
            Site.id, Site.site_name
        ).order_by(
            func.count(Employee.id).desc(),
            Site.site_name.asc()
        ).limit(5).all()

        sites_table = [
            {
                "site_id": str(row.id),
                "site_name": row.site_name,
                "employee_count": int(row.employee_count or 0),
            }
            for row in sites_rows
        ]

        # Work card status distribution (current month)
        status_rows = db.session.query(
            WorkCard.review_status,
            func.count(WorkCard.id).label("count")
        ).filter(
            WorkCard.business_id == g.business_id,
            WorkCard.processing_month == month_start
        ).group_by(WorkCard.review_status).all()

        work_card_status = [
            {"status": row.review_status, "count": int(row.count or 0)}
            for row in status_rows
        ]

        # Trends for last 12 months (inclusive)
        end_month = month_start
        start_month = _add_months(end_month, -11)
        end_month_exclusive = _add_months(end_month, 1)

        months: List[date] = []
        current = start_month
        while current <= end_month:
            months.append(current)
            current = _add_months(current, 1)

        month_labels = [m.strftime("%Y-%m") for m in months]

        employee_trend_rows = db.session.query(
            func.date_trunc('month', Employee.created_at).label("month"),
            func.count(Employee.id).label("count")
        ).filter(
            Employee.business_id == g.business_id,
            Employee.created_at >= start_month,
            Employee.created_at < end_month_exclusive
        ).group_by("month").all()

        site_trend_rows = db.session.query(
            func.date_trunc('month', Site.created_at).label("month"),
            func.count(Site.id).label("count")
        ).filter(
            Site.business_id == g.business_id,
            Site.created_at >= start_month,
            Site.created_at < end_month_exclusive
        ).group_by("month").all()

        work_card_trend_rows = db.session.query(
            WorkCard.processing_month.label("month"),
            func.count(WorkCard.id).label("count")
        ).filter(
            WorkCard.business_id == g.business_id,
            WorkCard.processing_month >= start_month,
            WorkCard.processing_month <= end_month
        ).group_by("month").all()

        def _trend_map(rows):
            mapped = {}
            for row in rows:
                month_val = row.month.date() if hasattr(row.month, "date") else row.month
                mapped[_month_start(month_val)] = int(row.count or 0)
            return mapped

        employee_map = _trend_map(employee_trend_rows)
        site_map = _trend_map(site_trend_rows)
        work_card_map = _trend_map(work_card_trend_rows)

        trends = {
            "months": month_labels,
            "employees": [employee_map.get(m, 0) for m in months],
            "sites": [site_map.get(m, 0) for m in months],
            "work_cards": [work_card_map.get(m, 0) for m in months],
        }

        payload = {
            "month": month_start.isoformat(),
            "generated_at": datetime.now(timezone.utc).isoformat(),
            "metrics": {
                "sites": int(sites_count),
                "employees": int(employees_count),
                "work_cards": int(work_cards_count),
            },
            "sites_table": sites_table,
            "work_card_status": work_card_status,
            "trends": trends,
        }

        _set_cached(cache_key, payload)
        return api_response(data=payload, meta={"cached": False, "cache_ttl_seconds": CACHE_TTL_SECONDS})
    except Exception as e:
        logger.exception("Failed to load dashboard summary")
        return api_response(status_code=500, message="Failed to load dashboard summary", error=str(e))
