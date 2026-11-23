"""Site report generation: the hours matrix loader and the XLSX writers for
the Summary and Salary reports.

Kept free of Flask request state so it can be used from routes, services and
tests alike. ``api/sites.py`` re-exports these names for backwards compatibility.
"""
import calendar
import re
import unicodedata
from copy import copy
from datetime import datetime
from io import BytesIO
from pathlib import Path

from openpyxl import load_workbook
from openpyxl.comments import Comment
from openpyxl.styles import PatternFill
from openpyxl.utils import get_column_letter
from sqlalchemy import case, func

from ...extensions import db
from ...models.sites import Employee, Site
from ...models.work_cards import WorkCard, WorkCardDayEntry


STATUS_DAY_LABELS = {
    'VACATION': 'חופשה',
    'SICK': 'מחלה',
    'INTERNATIONAL_VISA': 'ויזה בינלאומית',
    'HOLIDAY': 'חג',
}

# Israeli labor law requires special notice for workdays exceeding 12 hours.
# Per-day hours cells strictly above this threshold are shaded grey in exports.
LONG_DAY_HOURS_THRESHOLD = 12
LONG_DAY_FILL = PatternFill('solid', fgColor='D9D9D9')  # grey

# Marker for days an employee worked at a different site. Contractors receive
# these reports, so the label is deliberately generic and never names the site.
OTHER_SITE_LABEL = 'עבד באתר אחר'
# Used instead when the exporter opts in to naming the other site(s).
OTHER_SITE_NAMED_PREFIX = 'עבד באתר:'
OTHER_SITE_FILL = PatternFill('solid', fgColor='DDEBF7')  # light blue


def _is_long_day(value):
    return isinstance(value, (int, float)) and float(value) > LONG_DAY_HOURS_THRESHOLD


def _safe_label(value: str) -> str:
    if not value:
        return ''
    normalized = unicodedata.normalize('NFKC', value)
    cleaned = []
    for ch in normalized:
        cat = unicodedata.category(ch)
        if cat[0] in {'L', 'N'}:
            cleaned.append(ch)
        else:
            cleaned.append('_')
    label = ''.join(cleaned).strip('_')
    label = '_'.join(filter(None, label.split('_')))
    return label

def _safe_sheet_name(value: str, existing: set) -> str:
    if not value:
        base = 'Site'
    else:
        base = value
    invalid = ['\\', '/', '*', '[', ']', ':', '?']
    for ch in invalid:
        base = base.replace(ch, ' ')
    base = ' '.join(base.split()).strip()
    if not base:
        base = 'Site'
    # Trailing spaces are stripped by Excel when a workbook is saved, so a sheet
    # title that ends mid-word at the 31-char limit must be rstripped here to
    # stay round-trippable on re-import.
    base = base[:31].rstrip()
    candidate = base
    counter = 2
    while candidate in existing:
        suffix = f" {counter}"
        candidate = (base[:31 - len(suffix)] + suffix).rstrip()
        counter += 1
    existing.add(candidate)
    return candidate

def _resolve_summary_template_path() -> Path:
    """Resolve the Excel template used for batch site export."""
    base_dir = Path(__file__).resolve().parents[3]
    templates_dir = base_dir / 'excel_extraction_example'
    preferred = templates_dir / 'שעות עבודה לפי אתרים ינואר 26 (1).xlsx'
    if preferred.exists():
        return preferred

    candidates = sorted(templates_dir.glob('*.xlsx'))
    if not candidates:
        raise FileNotFoundError('No Excel template found in backend/excel_extraction_example')
    return candidates[0]

def _resolve_salary_template_path(month_date) -> Path:
    """Resolve salary export template for a month from employee_sheet_extraction."""
    root_dir = Path(__file__).resolve().parents[4]
    templates_dir = root_dir / 'employee_sheet_extraction'
    if not templates_dir.exists():
        raise FileNotFoundError('Template folder employee_sheet_extraction was not found')

    month_token = f"{month_date.month:02d}_{month_date.year}"
    month_candidates = []
    generic_candidates = []

    for candidate in sorted(templates_dir.glob('*.xlsx')):
        stem = candidate.stem.lower()
        if 'worker_new_hours_template' not in stem:
            continue
        generic_candidates.append(candidate)
        if month_token in stem or f"{month_date.month}_{month_date.year}" in stem:
            month_candidates.append(candidate)

    if month_candidates:
        return month_candidates[-1]
    if generic_candidates:
        return generic_candidates[-1]

    raise FileNotFoundError(
        f'No salary template found in {templates_dir} for {month_date.strftime("%Y-%m")}'
    )


def _extract_salary_day_columns_map(ws, month_date):
    """
    Parse row-1 day headers in salary template and return {day_number: column_index}.
    Expected header format per day column: "D.MM", e.g. "1.02".
    """
    day_columns = {}
    observed_months = set()
    pattern = re.compile(r'^\s*(\d{1,2})\.(\d{1,2})\s*$')

    for col in range(2, ws.max_column + 1):
        value = ws.cell(row=1, column=col).value
        if value is None:
            continue
        match = pattern.match(str(value))
        if not match:
            continue
        day = int(match.group(1))
        month = int(match.group(2))
        if day < 1 or day > 31:
            continue
        observed_months.add(month)
        day_columns[day] = col

    if not day_columns:
        raise ValueError('Invalid salary template format: missing day columns on header row')
    return day_columns


def _copy_salary_column_template(ws, source_col, target_col):
    """Copy style and width from one column to another across the worksheet."""
    source_letter = get_column_letter(source_col)
    target_letter = get_column_letter(target_col)
    ws.column_dimensions[target_letter].width = ws.column_dimensions[source_letter].width

    for row in range(1, ws.max_row + 1):
        source_cell = ws.cell(row=row, column=source_col)
        target_cell = ws.cell(row=row, column=target_col)
        target_cell._style = copy(source_cell._style)
        target_cell.number_format = source_cell.number_format
        target_cell.font = copy(source_cell.font)
        target_cell.fill = copy(source_cell.fill)
        target_cell.border = copy(source_cell.border)
        target_cell.alignment = copy(source_cell.alignment)
        target_cell.protection = copy(source_cell.protection)
        target_cell.value = source_cell.value


def _ensure_salary_template_month_columns(ws, month_date):
    """
    Ensure the salary sheet day columns match the requested month:
    - adjust number of day columns (insert/delete at the end of the day range)
    - rewrite header values to D.MM for requested month
    """
    parsed = _extract_salary_day_columns_map(ws, month_date)
    day_start_col = min(parsed.values())
    existing_days = max(parsed.keys())
    target_days = calendar.monthrange(month_date.year, month_date.month)[1]

    if existing_days < target_days:
        cols_to_add = target_days - existing_days
        insert_at = day_start_col + existing_days
        ws.insert_cols(insert_at, cols_to_add)
        for offset in range(cols_to_add):
            col_index = insert_at + offset
            _copy_salary_column_template(ws, insert_at - 1, col_index)
    elif existing_days > target_days:
        delete_start = day_start_col + target_days
        delete_count = existing_days - target_days
        ws.delete_cols(delete_start, delete_count)

    day_columns = {}
    for day in range(1, target_days + 1):
        col = day_start_col + day - 1
        ws.cell(row=1, column=col, value=f'{day}.{month_date.month:02d}')
        day_columns[day] = col
    return day_columns


def _find_salary_instruction_row(ws):
    """Find first row that starts the instructions block (contains 'הוראות' in column A)."""
    for row in range(2, ws.max_row + 1):
        cell_value = ws.cell(row=row, column=1).value
        if cell_value is None:
            continue
        if 'הוראות' in str(cell_value):
            return row
    raise ValueError('Invalid salary template format: could not find instructions row')


def _copy_salary_row_template(ws, source_row, target_row):
    """Copy style and baseline values from one template row to another."""
    for col in range(1, ws.max_column + 1):
        source_cell = ws.cell(row=source_row, column=col)
        target_cell = ws.cell(row=target_row, column=col)
        target_cell._style = copy(source_cell._style)
        target_cell.number_format = source_cell.number_format
        target_cell.font = copy(source_cell.font)
        target_cell.fill = copy(source_cell.fill)
        target_cell.border = copy(source_cell.border)
        target_cell.alignment = copy(source_cell.alignment)
        target_cell.protection = copy(source_cell.protection)
        target_cell.value = source_cell.value

    ws.row_dimensions[target_row].height = ws.row_dimensions[source_row].height


def _populate_salary_template_sheet(ws, employees, matrix, month_date, status_matrix=None, comment_matrix=None):
    """
    Populate salary template:
    - Row 1 remains as header (passport/day columns).
    - Employee rows start at row 2 and continue until instructions row.
    - Column A contains employee passport/ID.
    - Day columns contain numeric hours when available, otherwise remain blank
      (except prefilled 'שבת' values are preserved).
    - Per-day reviewer comments are attached as native Excel cell notes.
    """
    if status_matrix is None:
        status_matrix = {}
    if comment_matrix is None:
        comment_matrix = {}
    ws.sheet_view.rightToLeft = True
    day_columns = _ensure_salary_template_month_columns(ws, month_date)
    days_in_month = calendar.monthrange(month_date.year, month_date.month)[1]
    employee_start_row = 2
    instruction_row = _find_salary_instruction_row(ws)
    base_template_row = max(employee_start_row, instruction_row - 1)
    available_rows = max(0, instruction_row - employee_start_row)
    needed_rows = len(employees)

    if needed_rows > available_rows:
        rows_to_insert = needed_rows - available_rows
        ws.insert_rows(instruction_row, rows_to_insert)
        for row in range(instruction_row, instruction_row + rows_to_insert):
            _copy_salary_row_template(ws, base_template_row, row)
        instruction_row += rows_to_insert

    def clear_row(row_index):
        ws.cell(row=row_index, column=1, value=None)
        for day, col in day_columns.items():
            cell = ws.cell(row=row_index, column=col)
            is_saturday = day <= days_in_month and datetime(month_date.year, month_date.month, day).weekday() == 5
            cell.value = 'שבת' if is_saturday else None

    for idx, employee in enumerate(employees):
        row_index = employee_start_row + idx
        employee_id_value = (employee.passport_id or '').strip() if employee.passport_id else ''
        ws.cell(row=row_index, column=1, value=employee_id_value)

        employee_id_str = str(employee.id)
        employee_days = matrix.get(employee_id_str, {})
        employee_statuses = status_matrix.get(employee_id_str, {})
        employee_comments = comment_matrix.get(employee_id_str, {})
        for day, col in day_columns.items():
            cell = ws.cell(row=row_index, column=col)
            status = employee_statuses.get(day)
            if status:
                cell.value = STATUS_DAY_LABELS[status]
            else:
                hours = employee_days.get(day)
                if hours is None:
                    is_saturday = day <= days_in_month and datetime(month_date.year, month_date.month, day).weekday() == 5
                    cell.value = 'שבת' if is_saturday else None
                else:
                    numeric = round(float(hours), 2)
                    cell.value = numeric
                    if _is_long_day(numeric):
                        cell.fill = LONG_DAY_FILL
            comment_text = employee_comments.get(day)
            if comment_text:
                cell.comment = Comment(comment_text, 'AutomateHQ')

    for row_index in range(employee_start_row + needed_rows, instruction_row):
        clear_row(row_index)


def _sort_employees_for_export(employees):
    return sorted(
        employees,
        key=lambda e: (
            (e.full_name or '').strip().lower(),
            (e.passport_id or '').strip().lower(),
            str(e.id)
        )
    )


def _format_day_label(year: int, month: int, day: int, days_in_month: int):
    if day <= days_in_month and datetime(year, month, day).weekday() == 5:
        return f'{day}-שבת'
    return day


def _day_fallback_value(year: int, month: int, day: int, days_in_month: int):
    if day > days_in_month:
        return None
    if datetime(year, month, day).weekday() == 5:
        return 'שבת'
    return None


def _populate_template_core_sheet(
    ws,
    employees,
    matrix,
    month_date,
    style_header,
    style_body,
    style_total,
    status_matrix=None,
    monthly_totals=None,
    comment_matrix=None,
    other_site_days=None,
    other_site_labels=None,
):
    """Populate a worksheet in the core template format (no fee summary rows).

    When monthly_totals[employee_id] is set, the row-34 total cell for that
    employee is written as a literal value (the manual override) instead of
    the default =SUM(C3:C33) formula. Per-day cells still reflect any
    extracted/manual day entries — only the total cell is overridden.

    Per-day reviewer comments are attached as native Excel cell notes on the
    matching per-day hours cell.

    other_site_days[employee_id] lists days the employee worked at a different
    site. An otherwise-empty day shows OTHER_SITE_LABEL (text, so the SUM total
    ignores it); a day that also has local hours/status keeps its value and gets
    the label as a cell note instead.

    other_site_labels[employee_id][day], when given, replaces the generic label
    (e.g. to name the other site); it is only passed when the user opted in.
    """
    if status_matrix is None:
        status_matrix = {}
    if monthly_totals is None:
        monthly_totals = {}
    if comment_matrix is None:
        comment_matrix = {}
    other_site_sets = {
        employee_id: set(days) for employee_id, days in (other_site_days or {}).items()
    }
    other_site_labels = other_site_labels or {}
    days_in_month = calendar.monthrange(month_date.year, month_date.month)[1]
    employee_count = len(employees)
    last_data_col = max(2, employee_count + 1)

    # Clear template values (including fee/footer cells) while preserving worksheet settings.
    clear_max_col = max(last_data_col, ws.max_column)
    for row in range(1, 39):
        for col in range(1, clear_max_col + 1):
            ws.cell(row=row, column=col).value = None

    ws.sheet_view.rightToLeft = True

    ws.cell(row=1, column=1, value='יום בחודש')._style = copy(style_header)
    ws.cell(row=2, column=1, value=None)._style = copy(style_body)

    for idx, employee in enumerate(employees, start=2):
        passport_value = (employee.passport_id or '').strip() if employee.passport_id else ''
        ws.cell(row=1, column=idx, value=passport_value)._style = copy(style_header)
        first_name = (employee.full_name or '').split()[0] if employee.full_name else ''
        ws.cell(row=2, column=idx, value=first_name)._style = copy(style_body)

    # Body rows: one row per actual day in the month (rows 3..days_in_month+2)
    for day in range(1, days_in_month + 1):
        row = day + 2
        ws.cell(
            row=row,
            column=1,
            value=_format_day_label(month_date.year, month_date.month, day, days_in_month)
        )._style = copy(style_body)

        for idx, employee in enumerate(employees, start=2):
            employee_id_str = str(employee.id)
            status = status_matrix.get(employee_id_str, {}).get(day)
            worked_elsewhere = day in other_site_sets.get(employee_id_str, ())
            marker_label = other_site_labels.get(employee_id_str, {}).get(day) or OTHER_SITE_LABEL
            marker_in_cell = False
            if status:
                value = STATUS_DAY_LABELS[status]
            else:
                employee_days = matrix.get(employee_id_str, {})
                value = employee_days.get(day)
                if value is None:
                    if worked_elsewhere:
                        value = marker_label
                        marker_in_cell = True
                    else:
                        value = _day_fallback_value(month_date.year, month_date.month, day, days_in_month)
            cell = ws.cell(row=row, column=idx, value=value)
            cell._style = copy(style_body)
            if marker_in_cell:
                cell.fill = OTHER_SITE_FILL
            elif not status and _is_long_day(value):
                cell.fill = LONG_DAY_FILL
            note_parts = []
            if worked_elsewhere and not marker_in_cell:
                note_parts.append(marker_label)
            comment_text = comment_matrix.get(employee_id_str, {}).get(day)
            if comment_text:
                note_parts.append(comment_text)
            if note_parts:
                cell.comment = Comment('\n'.join(note_parts), 'AutomateHQ')

    # Clear template styling for any excess rows (e.g. days 29-31 when month has 28 days)
    for excess_day in range(days_in_month + 1, 32):
        excess_row = excess_day + 2
        for col in range(1, clear_max_col + 1):
            cell = ws.cell(row=excess_row, column=col)
            cell.value = None
            cell._style = copy(style_body)

    total_row = days_in_month + 3
    last_day_row = days_in_month + 2
    ws.cell(row=total_row, column=1, value='סה"כ')._style = copy(style_total)
    for col in range(2, last_data_col + 1):
        col_letter = get_column_letter(col)
        employee_idx = col - 2
        employee = employees[employee_idx] if employee_idx < len(employees) else None
        override = monthly_totals.get(str(employee.id)) if employee is not None else None
        if override is not None:
            cell_value = round(float(override), 2)
        else:
            cell_value = f'=SUM({col_letter}3:{col_letter}{last_day_row})'
        ws.cell(row=total_row, column=col, value=cell_value)._style = copy(style_total)

    return total_row

def _add_tariff_summary(ws, employee_count, hourly_tariff, style_body,
                        style_site_total, style_tariff, style_tariff_label,
                        total_row=34):
    """Add tariff/fee summary rows to a populated site sheet.

    Clears the template's fixed colored cells and, when the site has an
    hourly tariff, writes grand-total, price-per-hour, cost-without-VAT
    and cost-with-VAT at dynamic columns based on employee count.

    total_row: the row written by _populate_template_core_sheet for the
    'סה"כ' totals; defaults to 34 (31-day month). For shorter months this
    shifts up so that tariff rows follow immediately after the total.
    """
    TMPL_VALUE_COL = 8
    TMPL_LABEL_COL = 9

    last_data_col = max(2, employee_count + 1)
    value_col = last_data_col + 1
    label_col = value_col + 1

    label_row = total_row - 1   # last day row — used for site total label
    tariff_row = total_row + 2  # tariff per hour
    no_vat_row = total_row + 3  # cost without VAT
    vat_row = total_row + 4     # cost with VAT

    # Clear the template's fixed colored cells so stale content doesn't
    # appear on copied sheets.  For the data rows (last-day and total) we
    # must NOT overwrite employee columns — when there are 7+ employees,
    # column 8 (TMPL_VALUE_COL) is an employee column and clearing it would
    # destroy that employee's hours/total that _populate_template_core_sheet
    # just wrote.  The tariff-section rows (tariff_row and beyond) are safely
    # past all employee data so we always clear those.
    for r in (label_row, total_row, tariff_row, no_vat_row, vat_row):
        for c in (TMPL_VALUE_COL, TMPL_LABEL_COL):
            if r in (label_row, total_row) and c <= last_data_col:
                continue  # employee column in a data row — leave it alone
            cell = ws.cell(row=r, column=c)
            cell.value = None
            cell._style = copy(style_body)

    if hourly_tariff is not None:
        tariff = float(hourly_tariff)

        total_letters = [get_column_letter(c) for c in range(2, last_data_col + 1)]
        grand_total_formula = '=SUM(' + ','.join(f'{cl}{total_row}' for cl in total_letters) + ')'
        value_col_letter = get_column_letter(value_col)

        # Site total label (last day row, side column)
        ws.cell(row=label_row, column=value_col, value='סה"כ שעות לאתר:')._style = copy(style_site_total)

        # Grand total value (total row, side column)
        ws.cell(row=total_row, column=value_col, value=grand_total_formula)._style = copy(style_site_total)

        NIS_FORMAT = '[$₪-40D]#,##0.00'

        # Tariff per hour (numeric so no-VAT row can reference it in a formula)
        tariff_cell = ws.cell(row=tariff_row, column=value_col)
        tariff_cell.value = tariff
        tariff_cell._style = copy(style_tariff)
        tariff_cell.number_format = NIS_FORMAT
        ws.cell(row=tariff_row, column=label_col, value='מחיר לשעה')._style = copy(style_tariff_label)

        # Cost without VAT
        price_no_vat_cell = ws.cell(row=no_vat_row, column=value_col)
        price_no_vat_cell.value = f'={value_col_letter}{total_row}*{value_col_letter}{tariff_row}'
        price_no_vat_cell._style = copy(style_tariff)
        price_no_vat_cell.number_format = NIS_FORMAT
        ws.cell(row=no_vat_row, column=label_col, value='מחיר ללא מע"מ')._style = copy(style_tariff_label)

        # Cost with VAT (×1.18)
        price_vat_cell = ws.cell(row=vat_row, column=value_col)
        price_vat_cell.value = f'={value_col_letter}{no_vat_row}*1.18'
        price_vat_cell._style = copy(style_tariff)
        price_vat_cell.number_format = NIS_FORMAT
        ws.cell(row=vat_row, column=label_col, value='מחיר כולל מע"מ')._style = copy(style_tariff_label)


def _other_site_named_label(names):
    return f"{OTHER_SITE_NAMED_PREFIX} {', '.join(names)}"


def _build_other_site_labels(site_matrices, business_id):
    """Per site, map employee -> day -> label naming the other site(s).

    Only used when the user explicitly asks to show site names. One query for
    every referenced site, scoped to the business.
    """
    referenced = {
        other_id
        for site_data in site_matrices.values()
        for per_day in site_data.get('other_site_ids', {}).values()
        for other_ids in per_day.values()
        for other_id in other_ids
    }
    if not referenced:
        return {}
    names = {
        site.id: site.site_name
        for site in Site.query.filter(Site.business_id == business_id, Site.id.in_(referenced)).all()
    }
    def label_for(other_ids):
        known = [names[i] for i in other_ids if i in names]
        return _other_site_named_label(known) if known else OTHER_SITE_LABEL

    return {
        site_id: {
            employee_id_str: {day: label_for(other_ids) for day, other_ids in per_day.items()}
            for employee_id_str, per_day in site_data.get('other_site_ids', {}).items()
        }
        for site_id, site_data in site_matrices.items()
    }


def load_hours_matrix_for_sites(site_ids, processing_month, approved_only, include_inactive, business_id):
    """Bulk load employees + best-card hours matrix for multiple sites in a fixed query budget."""
    month = datetime.strptime(processing_month, '%Y-%m-%d').date()
    unique_site_ids = list(dict.fromkeys(site_ids or []))
    if not unique_site_ids:
        return {}

    site_results = {
        site_id: {'employees': [], 'matrix': {}, 'status_map': {}, 'status_matrix': {}, 'monthly_totals': {}, 'comment_matrix': {}, 'other_site_days': {}, 'other_site_ids': {}}
        for site_id in unique_site_ids
    }
    target_site_ids = set(unique_site_ids)

    # Baseline columns: employees whose home site is one of the target sites.
    # They appear as a column even with zero hours (preserves prior behavior).
    employee_query = db.session.query(Employee).filter(
        Employee.business_id == business_id,
        Employee.site_id.in_(unique_site_ids),
    )
    if not include_inactive:
        employee_query = employee_query.filter(Employee.is_active.is_(True))
    home_employees = employee_query.all()

    # Visiting employees: managed elsewhere (their card belongs to another site)
    # but with day entries attributed to a target site this month. Their hours
    # must surface here even though no card of theirs belongs to this site.
    visiting_employee_ids = {
        row[0]
        for row in db.session.query(WorkCard.employee_id)
        .join(WorkCardDayEntry, WorkCardDayEntry.work_card_id == WorkCard.id)
        .filter(
            WorkCard.business_id == business_id,
            WorkCard.processing_month == month,
            WorkCard.employee_id.isnot(None),
            WorkCardDayEntry.attributed_site_id.in_(unique_site_ids),
        )
        .distinct()
    }

    employees_by_id = {emp.id: emp for emp in home_employees}
    missing_ids = [eid for eid in visiting_employee_ids if eid not in employees_by_id]
    if missing_ids:
        visiting_query = db.session.query(Employee).filter(
            Employee.business_id == business_id,
            Employee.id.in_(missing_ids),
        )
        if not include_inactive:
            visiting_query = visiting_query.filter(Employee.is_active.is_(True))
        for emp in visiting_query.all():
            employees_by_id[emp.id] = emp

    # Seed home-employee columns; we add visiting employees as their entries land.
    added_columns = {site_id: set() for site_id in unique_site_ids}
    for emp in home_employees:
        site_results[emp.site_id]['employees'].append(emp)
        added_columns[emp.site_id].add(emp.id)

    def _finalize():
        for site_data in site_results.values():
            site_data['employees'] = _sort_employees_for_export(site_data['employees'])
        return site_results

    relevant_employee_ids = list({emp.id for emp in home_employees} | visiting_employee_ids)
    if not relevant_employee_ids:
        return _finalize()

    # Best (managing) card per relevant employee for the month, ranked across ALL
    # their cards regardless of site: a transferred employee's card lives at their
    # final/home site yet contributes days to the sites they moved through.
    ranked_cards = db.session.query(
        WorkCard.id.label('work_card_id'),
        WorkCard.site_id,
        WorkCard.employee_id,
        WorkCard.review_status,
        WorkCard.monthly_total_hours,
        func.row_number().over(
            partition_by=WorkCard.employee_id,
            order_by=[
                case(
                    (WorkCard.review_status == 'APPROVED', 1),
                    else_=2
                ),
                WorkCard.created_at.desc()
            ]
        ).label('rank')
    ).filter(
        WorkCard.business_id == business_id,
        WorkCard.processing_month == month,
        WorkCard.employee_id.in_(relevant_employee_ids),
    )

    if approved_only:
        ranked_cards = ranked_cards.filter(WorkCard.review_status == 'APPROVED')

    ranked_cards = ranked_cards.subquery()

    best_cards_rows = db.session.query(
        ranked_cards.c.work_card_id,
        ranked_cards.c.site_id,
        ranked_cards.c.employee_id,
        ranked_cards.c.review_status,
        ranked_cards.c.monthly_total_hours,
    ).filter(
        ranked_cards.c.rank == 1
    ).all()

    if not best_cards_rows:
        return _finalize()

    # card_id -> (card_site_id, employee_id, review_status)
    work_card_meta = {}
    work_card_ids = []
    for row in best_cards_rows:
        work_card_ids.append(row.work_card_id)
        work_card_meta[str(row.work_card_id)] = (row.site_id, row.employee_id, row.review_status)
        # The managing card's site records the employee's overall status (for the
        # summary view), if that site is in scope.
        if row.site_id in target_site_ids:
            site_results[row.site_id]['status_map'][str(row.employee_id)] = row.review_status

    day_entries = db.session.query(
        WorkCardDayEntry.work_card_id,
        WorkCardDayEntry.day_of_month,
        WorkCardDayEntry.total_hours,
        WorkCardDayEntry.day_status,
        WorkCardDayEntry.attributed_site_id,
        WorkCardDayEntry.comment,
    ).filter(
        WorkCardDayEntry.work_card_id.in_(work_card_ids)
    ).all()

    # Employees with any cross-site attribution: their hours are spread per-day,
    # so a single card-level monthly_total can't be applied (see below).
    split_employee_ids = set()

    # employee_id_str -> day -> effective sites with recorded hours that day.
    # Collected for every site (in scope or not) to derive the generic
    # "worked at another site" marker; site ids never leave this function.
    worked_sites = {}

    for entry in day_entries:
        meta = work_card_meta.get(str(entry.work_card_id))
        if not meta:
            continue
        card_site_id, employee_id, review_status = meta
        employee_id_str = str(employee_id)

        effective_site = entry.attributed_site_id or card_site_id
        if entry.attributed_site_id is not None and entry.attributed_site_id != card_site_id:
            split_employee_ids.add(employee_id_str)

        # Only confirmed attendance counts: recorded positive hours, no status.
        if not entry.day_status and entry.total_hours is not None and float(entry.total_hours) > 0:
            worked_sites.setdefault(employee_id_str, {}).setdefault(entry.day_of_month, set()).add(effective_site)

        if effective_site not in target_site_ids:
            continue

        site_data = site_results[effective_site]
        # Surface a visiting employee as a column the first time a day lands here.
        if employee_id not in added_columns[effective_site] and employee_id in employees_by_id:
            site_data['employees'].append(employees_by_id[employee_id])
            added_columns[effective_site].add(employee_id)
        site_data['status_map'][employee_id_str] = review_status

        if entry.day_status:
            site_data['status_matrix'].setdefault(employee_id_str, {})[entry.day_of_month] = entry.day_status
        elif entry.total_hours is not None:
            site_data['matrix'].setdefault(employee_id_str, {})[entry.day_of_month] = float(entry.total_hours)

        # A per-day comment can accompany either an hours day or a status day,
        # so accumulate it independently of the branch above.
        if entry.comment:
            site_data['comment_matrix'].setdefault(employee_id_str, {})[entry.day_of_month] = entry.comment

    # monthly_total_hours is a single card-level figure used when per-day hours
    # aren't recorded. It cannot be divided across sites, so it only applies to a
    # non-split employee, attributed to their managing card's site.
    for row in best_cards_rows:
        if row.monthly_total_hours is None:
            continue
        employee_id_str = str(row.employee_id)
        if employee_id_str in split_employee_ids:
            continue
        if row.site_id in target_site_ids:
            site_results[row.site_id]['monthly_totals'][employee_id_str] = float(row.monthly_total_hours)
            if row.employee_id not in added_columns[row.site_id] and row.employee_id in employees_by_id:
                site_results[row.site_id]['employees'].append(employees_by_id[row.employee_id])
                added_columns[row.site_id].add(row.employee_id)

    # For each employee column, mark days with hours recorded at any other site.
    # other_site_days (day numbers only) is what the API and the anonymous
    # export use; other_site_ids stays server-side for the named export option.
    for site_id, site_data in site_results.items():
        for emp in site_data['employees']:
            employee_id_str = str(emp.id)
            per_day = {
                day: sorted(sites - {site_id}, key=str)
                for day, sites in worked_sites.get(employee_id_str, {}).items()
                if sites - {site_id}
            }
            if per_day:
                site_data['other_site_days'][employee_id_str] = sorted(per_day)
                site_data['other_site_ids'][employee_id_str] = per_day

    return _finalize()


def other_site_labels_for_site(site_id, site_data, business_id):
    """employee -> day -> label naming the other site(s), for one site's data."""
    return _build_other_site_labels({site_id: site_data}, business_id).get(site_id, {})


def build_summary_workbook(site, employees, matrix, month, status_matrix, monthly_totals=None, comment_matrix=None, other_site_days=None, other_site_labels=None):
    """Build the single-site monthly summary workbook from the summary template.

    ``other_site_labels`` (employee -> day -> label), when given, names the
    other site instead of the generic marker."""
    template_path = _resolve_summary_template_path()
    workbook = load_workbook(template_path)

    ws = workbook.worksheets[0]
    style_header = copy(ws['B1']._style)
    style_body = copy(ws['B3']._style)
    style_total = copy(ws['A34']._style)
    style_site_total = copy(ws.cell(row=33, column=8)._style)
    style_tariff = copy(ws.cell(row=36, column=8)._style)
    style_tariff_label = copy(ws.cell(row=36, column=9)._style)

    ws.title = _safe_sheet_name(site.site_name, set())

    total_row = _populate_template_core_sheet(
        ws,
        employees,
        matrix,
        month,
        style_header=style_header,
        style_body=style_body,
        style_total=style_total,
        status_matrix=status_matrix,
        monthly_totals=monthly_totals,
        comment_matrix=comment_matrix,
        other_site_days=other_site_days,
        other_site_labels=other_site_labels,
    )

    for extra_ws in workbook.worksheets[1:]:
        workbook.remove(extra_ws)

    _add_tariff_summary(
        ws,
        employee_count=len(employees),
        hourly_tariff=site.hourly_tariff,
        style_body=style_body,
        style_site_total=style_site_total,
        style_tariff=style_tariff,
        style_tariff_label=style_tariff_label,
        total_row=total_row,
    )
    return workbook


def _generate_summary_xlsx(site, employees, matrix, month, status_matrix, monthly_totals=None, comment_matrix=None, other_site_days=None, other_site_labels=None):
    """Generate a monthly summary XLSX workbook and return (BytesIO, filename)."""
    workbook = build_summary_workbook(
        site, employees, matrix, month, status_matrix, monthly_totals, comment_matrix, other_site_days,
        other_site_labels,
    )

    output = BytesIO()
    workbook.save(output)
    output.seek(0)

    site_label = _safe_label(site.site_name) or str(site.id)
    filename = f"monthly_summary_{site.id}_{site_label}_{month.strftime('%Y-%m')}.xlsx"
    return output, filename


def empty_site_data():
    """The shape load_hours_matrix_for_sites returns for a site with no data."""
    return {
        'employees': [], 'matrix': {}, 'status_map': {}, 'status_matrix': {},
        'monthly_totals': {}, 'comment_matrix': {}, 'other_site_days': {}, 'other_site_ids': {},
    }


def populate_summary_batch_workbook(workbook, sites, site_matrices, month, other_site_labels=None):
    """Fill a freshly loaded summary template workbook with one sheet per site.

    ``workbook`` must be the summary template as loaded from disk. When no site
    is given the template sheet is kept as a single empty 'Sites' sheet.
    Returns the total number of employee columns written.
    """
    other_site_labels = other_site_labels or {}
    template_ws = workbook.worksheets[0]
    style_header = copy(template_ws['B1']._style)
    style_body = copy(template_ws['B3']._style)
    style_total = copy(template_ws['A34']._style)
    style_site_total = copy(template_ws.cell(row=33, column=8)._style)
    style_tariff = copy(template_ws.cell(row=36, column=8)._style)
    style_tariff_label = copy(template_ws.cell(row=36, column=9)._style)

    for ws in workbook.worksheets[1:]:
        workbook.remove(ws)

    total_employee_count = 0
    used_sheet_names = set()
    for site in sites:
        site_data = site_matrices.get(site.id) or empty_site_data()
        total_employee_count += len(site_data['employees'])

        ws = workbook.copy_worksheet(template_ws)
        ws.title = _safe_sheet_name(site.site_name, used_sheet_names)
        total_row = _populate_template_core_sheet(
            ws,
            site_data['employees'],
            site_data['matrix'],
            month,
            style_header=style_header,
            style_body=style_body,
            style_total=style_total,
            status_matrix=site_data['status_matrix'],
            monthly_totals=site_data.get('monthly_totals'),
            comment_matrix=site_data.get('comment_matrix'),
            other_site_days=site_data.get('other_site_days'),
            other_site_labels=other_site_labels.get(site.id),
        )
        _add_tariff_summary(
            ws,
            employee_count=len(site_data['employees']),
            hourly_tariff=site.hourly_tariff,
            style_body=style_body,
            style_site_total=style_site_total,
            style_tariff=style_tariff,
            style_tariff_label=style_tariff_label,
            total_row=total_row,
        )

    if workbook.worksheets and len(workbook.worksheets) > 1:
        workbook.remove(template_ws)
    else:
        _populate_template_core_sheet(
            template_ws,
            [],
            {},
            month,
            style_header=style_header,
            style_body=style_body,
            style_total=style_total,
        )
        template_ws.title = 'Sites'

    return total_employee_count


def build_salary_workbook(site, employees, matrix, month, status_matrix=None, comment_matrix=None):
    """Build the single-site salary workbook from the month's salary template.

    Raises FileNotFoundError when no template exists and ValueError when the
    template does not have the expected layout.
    """
    workbook = load_workbook(_resolve_salary_template_path(month))
    ws = workbook.worksheets[0]
    _populate_salary_template_sheet(ws, employees, matrix, month, status_matrix, comment_matrix)
    ws.title = _safe_sheet_name(site.site_name, set())
    return workbook


def populate_salary_batch_workbook(workbook, sites, site_matrices, month):
    """Fill a freshly loaded salary template workbook with one sheet per site.

    When no site is given the template sheet is kept as a single empty 'Sites'
    sheet. Raises ValueError when the template layout is invalid. Returns the
    total number of employee rows written.
    """
    template_ws = workbook.worksheets[0]
    for ws in workbook.worksheets[1:]:
        workbook.remove(ws)

    total_employee_count = 0
    used_sheet_names = set()
    populated_count = 0
    for site in sites:
        site_data = site_matrices.get(site.id) or empty_site_data()
        total_employee_count += len(site_data['employees'])

        ws = workbook.copy_worksheet(template_ws)
        ws.title = _safe_sheet_name(site.site_name, used_sheet_names)
        _populate_salary_template_sheet(
            ws, site_data['employees'], site_data['matrix'], month,
            site_data['status_matrix'], site_data.get('comment_matrix'),
        )
        populated_count += 1

    if populated_count > 0 and len(workbook.worksheets) > 1:
        workbook.remove(template_ws)
    else:
        _populate_salary_template_sheet(template_ws, [], {}, month)
        template_ws.title = 'Sites'

    return total_employee_count
