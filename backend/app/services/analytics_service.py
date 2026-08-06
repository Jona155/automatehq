"""Hours-utilization analytics aggregation (PRD: Employee Performance Analytics).

Builds the site scorecard and site-detail payloads on top of the per-month
``utilization_service.compute_utilization`` metric. Handles:
  - period resolution (prev month / last 3 / last 6 complete months),
  - a small per-process TTL cache of the expensive per-month compute,
  - period aggregation (headline utilization = Σ hours ÷ (target × N months)),
  - per-site aggregate blocks (avg, spread, band distribution).

Role scoping (which sites a caller may see) is enforced in the API layer; this
service is scope-agnostic except that the callers pass the allowed site ids.
"""

import os
import statistics
from datetime import date, datetime, timezone

from ..constants import (
    MONTHLY_TARGET_HOURS,
    classify_band,
    BAND_LOW,
    BAND_HIGH,
    BAND_MID,
    BAND_MID_MIN,
)
from ..extensions import db
from ..models.sites import Site
from .utilization_service import compute_utilization


# ---------------------------------------------------------------------------
# Period resolution (no python-dateutil available; mirror dashboard.py idiom)
# ---------------------------------------------------------------------------

VALID_PERIODS = ('prev_month', 'last_3_months', 'last_6_months')
_PERIOD_MONTHS = {'prev_month': 1, 'last_3_months': 3, 'last_6_months': 6}


def _month_start(d):
    return date(d.year, d.month, 1)


def _add_months(d, months):
    year = d.year + (d.month - 1 + months) // 12
    month = (d.month - 1 + months) % 12 + 1
    return date(year, month, 1)


def resolve_period(period, today=None):
    """Resolve a period keyword to a list of first-of-month dates (ascending).

    The current (incomplete) month is never included. Unknown/None period falls
    back to ``prev_month``. ``last_3_months`` in July -> [Apr, May, Jun].
    """
    if today is None:
        today = datetime.now(timezone.utc).date()
    n = _PERIOD_MONTHS.get(period, 1)
    prev = _add_months(_month_start(today), -1)  # last complete month
    return [_add_months(prev, -(n - 1 - i)) for i in range(n)]


# ---------------------------------------------------------------------------
# Per-month utilization cache
# ---------------------------------------------------------------------------

CACHE_TTL_SECONDS = int(os.environ.get('ANALYTICS_CACHE_TTL_SECONDS', 300))
_CACHE = {}  # (business_id_str, month_iso) -> {"ts": datetime, "data": dict}


def _cached_utilization(business_id, month_date, bust=False):
    key = (str(business_id), month_date.isoformat())
    if not bust:
        cached = _CACHE.get(key)
        if cached:
            age = (datetime.now(timezone.utc) - cached['ts']).total_seconds()
            if age <= CACHE_TTL_SECONDS:
                return cached['data'], True
            _CACHE.pop(key, None)
    data = compute_utilization(business_id, month_date.strftime('%Y-%m-%d'))
    _CACHE[key] = {'ts': datetime.now(timezone.utc), 'data': data}
    return data, False


def invalidate_business_cache(business_id):
    """Drop cached utilization for a business — call on writes that change hours."""
    bid = str(business_id)
    for key in [k for k in _CACHE if k[0] == bid]:
        _CACHE.pop(key, None)


# ---------------------------------------------------------------------------
# Period aggregation
# ---------------------------------------------------------------------------

def _aggregate_period(business_id, months, bust=False):
    """Aggregate per-employee hours across the period's months.

    Returns dict:
        employees: {emp_str: {employee_id, full_name, external_employee_id,
                              total_hours, utilization_pct, band,
                              per_site: {site_str: hours}}}
        site_members: {site_str: [emp_str, ...]}  (union across months)
        n_months, target_hours, any_cache_hit
    """
    n = len(months) or 1
    employees = {}
    site_members = {}
    any_cache_hit = False

    for month_date in months:
        payload, hit = _cached_utilization(business_id, month_date, bust=bust)
        any_cache_hit = any_cache_hit or hit

        for emp_str, emp in payload['employees'].items():
            acc = employees.get(emp_str)
            if acc is None:
                acc = employees[emp_str] = {
                    'employee_id': emp['employee_id'],
                    'full_name': emp['full_name'],
                    'external_employee_id': emp.get('external_employee_id'),
                    'total_hours': 0.0,
                    'per_site': {},
                }
            acc['total_hours'] += emp['hours']
            for site_str, hrs in emp['per_site'].items():
                acc['per_site'][site_str] = acc['per_site'].get(site_str, 0.0) + hrs

        for site_str, member_ids in payload.get('site_members', {}).items():
            bucket = site_members.setdefault(site_str, set())
            bucket.update(member_ids)

    target = MONTHLY_TARGET_HOURS * n
    for acc in employees.values():
        acc['utilization_pct'] = acc['total_hours'] / target * 100
        acc['band'] = classify_band(acc['utilization_pct'])

    return {
        'employees': employees,
        'site_members': {s: sorted(ids) for s, ids in site_members.items()},
        'n_months': n,
        'target_hours': target,
        'any_cache_hit': any_cache_hit,
    }


def _aggregate_block(utils):
    """Aggregate a list of utilization percentages into a site-health block."""
    count = len(utils)
    if count == 0:
        return {
            'avg_utilization': None,
            'band': None,
            'employee_count': 0,
            'low_performer_count': 0,
            'spread': {'stddev': None, 'min': None, 'max': None},
            'band_distribution': {BAND_HIGH: 0, BAND_MID: 0, BAND_LOW: 0},
        }
    avg = sum(utils) / count
    distribution = {BAND_HIGH: 0, BAND_MID: 0, BAND_LOW: 0}
    for u in utils:
        distribution[classify_band(u)] += 1
    return {
        'avg_utilization': avg,
        'band': classify_band(avg),
        'employee_count': count,
        'low_performer_count': distribution[BAND_LOW],
        'spread': {
            'stddev': statistics.pstdev(utils) if count > 1 else 0.0,
            'min': min(utils),
            'max': max(utils),
        },
        'band_distribution': distribution,
    }


def _site_name_map(business_id):
    return {
        str(sid): name
        for sid, name in db.session.query(Site.id, Site.site_name).filter(
            Site.business_id == business_id,
        ).all()
    }


# ---------------------------------------------------------------------------
# Per-month trend series (T17). Reuses the cached single-month payloads, so no
# extra queries beyond what the period aggregation already loads.
# ---------------------------------------------------------------------------

def _collect_month_payloads(business_id, months, bust=False):
    """[(label 'YYYY-MM', single-month utilization payload)] for each month."""
    out = []
    for m in months:
        payload, _ = _cached_utilization(business_id, m, bust=bust)
        out.append((m.strftime('%Y-%m'), payload))
    return out


def _site_trend(month_payloads, site_str):
    """Per-month average utilization of the site's members (null when empty)."""
    trend = []
    for label, payload in month_payloads:
        members = payload.get('site_members', {}).get(site_str, [])
        utils = [payload['employees'][x]['utilization_pct'] for x in members if x in payload['employees']]
        trend.append({'month': label, 'utilization': (sum(utils) / len(utils)) if utils else None})
    return trend


def _employee_trend(month_payloads, emp_str):
    """Per-month utilization for one employee (0 in a month with no hours)."""
    trend = []
    for label, payload in month_payloads:
        e = payload['employees'].get(emp_str)
        trend.append({'month': label, 'utilization': e['utilization_pct'] if e else 0.0})
    return trend


# ---------------------------------------------------------------------------
# Public builders (consumed by the analytics API blueprint)
# ---------------------------------------------------------------------------

def build_site_scorecards(business_id, months, allowed_site_ids, bust=False):
    """Per-site aggregates for the in-scope sites, sorted worst-first.

    ``allowed_site_ids`` is the role-scoped, active site set the caller may see;
    every one is returned as a card (empty sites included with count 0).
    """
    agg = _aggregate_period(business_id, months, bust=bust)
    employees = agg['employees']
    names = _site_name_map(business_id)
    month_payloads = _collect_month_payloads(business_id, months, bust=bust)

    cards = []
    for site_id in allowed_site_ids:
        site_str = str(site_id)
        members = agg['site_members'].get(site_str, [])
        utils = [employees[m]['utilization_pct'] for m in members if m in employees]
        hours = [employees[m]['total_hours'] for m in members if m in employees]
        block = _aggregate_block(utils)
        cards.append({
            'site_id': site_str,
            'site_name': names.get(site_str),
            'avg_hours': (sum(hours) / len(hours)) if hours else None,
            'trend': _site_trend(month_payloads, site_str),
            **block,
        })

    # Worst-first: ascending average; empty sites (avg None) sink to the bottom.
    cards.sort(key=lambda c: (c['avg_utilization'] is None, c['avg_utilization'] or 0.0))

    # Headline tiles — scoped to the caller's in-scope sites only (union of their
    # members, deduped so a multi-site worker is counted once).
    in_scope_ids = set()
    for site_id in allowed_site_ids:
        in_scope_ids.update(agg['site_members'].get(str(site_id), []))
    scoped_utils = [employees[e]['utilization_pct'] for e in in_scope_ids if e in employees]
    scoped_hours = [employees[e]['total_hours'] for e in in_scope_ids if e in employees]
    overall_avg = (sum(scoped_utils) / len(scoped_utils)) if scoped_utils else None
    overall_avg_hours = (sum(scoped_hours) / len(scoped_hours)) if scoped_hours else None
    if overall_avg is None:
        below = above = 0
    else:
        below = sum(1 for u in scoped_utils if u < overall_avg)
        above = sum(1 for u in scoped_utils if u >= overall_avg)
    sites_meeting = sum(
        1 for c in cards if c['avg_utilization'] is not None and c['avg_utilization'] >= BAND_MID_MIN
    )

    # Company-wide monthly trend — a FIXED last-6-months lookback, independent of
    # the selected period, so the hero always shows context. Per-month membership
    # dedupes multi-site workers (counted once per month). Null in an empty month.
    trend_payloads = _collect_month_payloads(business_id, resolve_period('last_6_months'), bust=bust)
    allowed_strs = [str(s) for s in allowed_site_ids]
    overall_trend = []
    for label, payload in trend_payloads:
        members = set()
        for s in allowed_strs:
            members.update(payload.get('site_members', {}).get(s, []))
        emps = payload['employees']
        utils = [emps[e]['utilization_pct'] for e in members if e in emps]
        overall_trend.append({'month': label, 'utilization': (sum(utils) / len(utils)) if utils else None})

    summary = {
        'total_sites': len(cards),
        'sites_meeting_criteria': sites_meeting,       # avg utilization >= 70%
        'total_employees': len(scoped_utils),
        'employees_below_average': below,
        'employees_above_average': above,
        'overall_avg_utilization': overall_avg,
        'overall_avg_hours': overall_avg_hours,
    }

    return {
        'target_hours': agg['target_hours'],
        'n_months': agg['n_months'],
        'company_avg_utilization': overall_avg,        # kept for compat; now scoped
        'trend': overall_trend,                         # company-wide monthly trend
        'summary': summary,
        'sites': cards,
        'any_cache_hit': agg['any_cache_hit'],
    }


def build_site_detail(business_id, months, site_id, bust=False):
    """Employee leaderboard + health for one site (worst-first)."""
    agg = _aggregate_period(business_id, months, bust=bust)
    employees = agg['employees']
    names = _site_name_map(business_id)
    month_payloads = _collect_month_payloads(business_id, months, bust=bust)
    site_str = str(site_id)

    members = agg['site_members'].get(site_str, [])
    member_emps = [employees[m] for m in members if m in employees]
    utils = [e['utilization_pct'] for e in member_emps]
    health = _aggregate_block(utils)
    health['trend'] = _site_trend(month_payloads, site_str)
    site_avg = health['avg_utilization']

    # Site average worked HOURS (for the hours-based delta the UI shows).
    member_hours = [e['total_hours'] for e in member_emps]
    avg_hours = (sum(member_hours) / len(member_hours)) if member_hours else None
    health['avg_hours'] = avg_hours

    rows = []
    for emp in member_emps:
        emp_str = str(emp['employee_id'])
        sites_worked = [
            {'site_id': s, 'site_name': names.get(s), 'hours': hrs}
            for s, hrs in emp['per_site'].items()
        ]
        rows.append({
            'employee_id': emp_str,
            'full_name': emp['full_name'],
            'external_employee_id': emp.get('external_employee_id'),
            'utilization_pct': emp['utilization_pct'],
            'band': emp['band'],
            'hours_at_site': emp['per_site'].get(site_str, 0.0),
            'total_hours': emp['total_hours'],
            'delta_vs_site_avg': (emp['utilization_pct'] - site_avg) if site_avg is not None else None,
            'delta_hours_vs_site_avg': (emp['total_hours'] - avg_hours) if avg_hours is not None else None,
            'is_multi_site': len(emp['per_site']) > 1,
            'sites_worked': sites_worked,
            'trend': _employee_trend(month_payloads, emp_str),
        })

    rows.sort(key=lambda r: r['utilization_pct'])  # worst-first

    # Fixed last-6-months trend for the hero (independent of the selected period).
    trend_payloads = _collect_month_payloads(business_id, resolve_period('last_6_months'), bust=bust)
    site_trend_6m = _site_trend(trend_payloads, site_str)

    return {
        'site_id': site_str,
        'site_name': names.get(site_str),
        'target_hours': agg['target_hours'],
        'n_months': agg['n_months'],
        'trend': site_trend_6m,          # 6-month lookback for the hero chart
        'site_health': health,
        'employees': rows,
        'any_cache_hit': agg['any_cache_hit'],
    }


def build_employee_detail(business_id, months, site_id, employee_id, bust=False):
    """One employee's detail: utilization vs target, site & company averages,
    and a month-over-month trend. Returns None if the employee is not a member
    of the given site in the period (caller maps that to 404)."""
    agg = _aggregate_period(business_id, months, bust=bust)
    employees = agg['employees']
    names = _site_name_map(business_id)
    month_payloads = _collect_month_payloads(business_id, months, bust=bust)
    site_str = str(site_id)
    emp_str = str(employee_id)

    members = agg['site_members'].get(site_str, [])
    if emp_str not in members or emp_str not in employees:
        return None

    emp = employees[emp_str]

    # Company average = mean of every employee's period utilization.
    all_utils = [e['utilization_pct'] for e in employees.values()]
    company_avg = (sum(all_utils) / len(all_utils)) if all_utils else None

    # Site average = mean over this site's members.
    site_utils = [employees[m]['utilization_pct'] for m in members if m in employees]
    site_avg = (sum(site_utils) / len(site_utils)) if site_utils else None

    sites_worked = [
        {'site_id': s, 'site_name': names.get(s), 'hours': hrs}
        for s, hrs in emp['per_site'].items()
    ]

    return {
        'site_id': site_str,
        'site_name': names.get(site_str),
        'employee_id': emp_str,
        'full_name': emp['full_name'],
        'external_employee_id': emp.get('external_employee_id'),
        'utilization_pct': emp['utilization_pct'],
        'band': emp['band'],
        'total_hours': emp['total_hours'],
        'hours_at_site': emp['per_site'].get(site_str, 0.0),
        'target_hours': agg['target_hours'],
        'n_months': agg['n_months'],
        'site_avg_utilization': site_avg,
        'company_avg_utilization': company_avg,
        'trend': _employee_trend(month_payloads, emp_str),
        'sites_worked': sites_worked,
        'any_cache_hit': agg['any_cache_hit'],
    }
