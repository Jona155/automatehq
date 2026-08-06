"""Employee hours-utilization computation (PRD: Employee Performance Analytics).

Given a business + month, returns per-employee worked hours, utilization %
(against MONTHLY_TARGET_HOURS), performance band, and the hours contributed per
site.

Card selection / cross-site attribution / monthly_total fallback are NOT
re-implemented here: they are delegated to ``load_hours_matrix_for_sites`` in
``app.api.sites`` (the single production source of that logic), so utilization
stays consistent with the hours matrix and payroll export. See the plan/PRD for
the deviation note (the PRD-cited hours_matrix_service CTE is single-site and
lacks the attributed_site_id + monthly_total_hours handling).
"""

from ..constants import MONTHLY_TARGET_HOURS, classify_band
from ..extensions import db
from ..models.sites import Site


def _sum_days(day_map):
    """Sum a {day_of_month: hours} dict, ignoring Nones."""
    return sum(v for v in day_map.values() if v is not None)


def compute_utilization(business_id, month):
    """Compute per-employee utilization for a business in one month.

    Args:
        business_id: the tenant's business UUID.
        month: first-of-month date string ``'YYYY-MM-DD'`` (parsed downstream,
            same convention as the sites hours-matrix endpoints).

    Returns:
        dict with:
          - ``target_hours``: the MONTHLY_TARGET_HOURS used.
          - ``employees``: dict keyed by ``str(employee_id)`` ->
                {employee_id, full_name, external_employee_id, hours,
                 utilization_pct, band, per_site: {str(site_id): hours}}.
          - ``site_members``: dict ``{str(site_id): [str(employee_id), ...]}`` —
                every employee surfaced at a site (home + visiting), INCLUDING
                zero-hour home employees, so site-level views can count them.
        Employees with zero hours are included (seeded as home-site columns by
        the matrix loader) so downstream UI can decide how to display them.
    """
    # Deferred import: load_hours_matrix_for_sites lives in an api module; keep
    # the import local to avoid any import-time cycle with the blueprint layer.
    from ..api.sites import load_hours_matrix_for_sites

    # Every site in the business. Hours are already month-scoped, so including
    # inactive sites only ensures we don't drop hours attributed to a site that
    # was later deactivated — the headline must be the employee's TRUE monthly
    # total across all sites (PRD §5 multi-site attribution).
    site_ids = [row[0] for row in db.session.query(Site.id).filter(
        Site.business_id == business_id,
    ).all()]

    result = {'target_hours': MONTHLY_TARGET_HOURS, 'employees': {}, 'site_members': {}}
    if not site_ids:
        return result

    site_results = load_hours_matrix_for_sites(
        site_ids=site_ids,
        processing_month=month,
        approved_only=False,      # best-ranked card regardless of status
        include_inactive=False,   # active employees only
        business_id=business_id,
    )

    # Gather every employee surfaced across sites (home + visiting), and record
    # per-site membership (used by site-level analytics; keeps zero-hour home
    # employees attributed to their site).
    employees_by_id = {}
    site_members = result['site_members']
    for site_id, site_data in site_results.items():
        member_ids = [str(emp.id) for emp in site_data['employees']]
        site_members[str(site_id)] = member_ids
        for emp in site_data['employees']:
            employees_by_id[str(emp.id)] = emp

    employees_out = result['employees']
    for emp_str, emp in employees_by_id.items():
        day_per_site = {}
        total_per_site = {}
        for site_id, site_data in site_results.items():
            site_key = str(site_id)
            day_hours = _sum_days(site_data['matrix'].get(emp_str, {}))
            if day_hours:
                day_per_site[site_key] = float(day_hours)
            monthly_total = site_data['monthly_totals'].get(emp_str)
            if monthly_total:
                total_per_site[site_key] = float(monthly_total)

        # Per-day hours are authoritative; the card-level monthly_total is only a
        # fallback used when the managing card has no per-day entries at all.
        if day_per_site:
            per_site = day_per_site
        else:
            per_site = total_per_site
        hours = float(sum(per_site.values()))

        utilization_pct = hours / MONTHLY_TARGET_HOURS * 100
        employees_out[emp_str] = {
            'employee_id': emp.id,
            'full_name': emp.full_name,
            # Serial number from the employee Excel import ('מספר סידורי') — the
            # UI shows it alongside first-name-only labels to disambiguate.
            'external_employee_id': emp.external_employee_id,
            'hours': hours,
            'utilization_pct': utilization_pct,
            'band': classify_band(utilization_pct),
            'per_site': per_site,
        }

    return result
