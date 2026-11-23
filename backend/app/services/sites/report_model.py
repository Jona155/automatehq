"""A JSON-friendly model of a site report, for previewing it in the browser.

The model is read off the very workbook the download is built from, so what the
preview shows is what the XLSX contains by construction — there is no second
implementation of the report layout to keep in sync.

Each cell carries a ``kind``:
  * ``input``      — a per-day value (hours / status) for one employee.
  * ``calculated`` — a formula cell; ``value`` holds the computed result.
  * ``protected``  — everything else (identifiers, headers, labels, tariff).

``input`` cells also carry ``employee_id`` and ``day``. That pair, never the
row/column position, is the identity anything attached to a cell must use.
"""
import calendar
import re

from openpyxl.utils import get_column_letter, range_boundaries

from .report_export import (
    OTHER_SITE_LABEL,
    _extract_salary_day_columns_map,
    _find_salary_instruction_row,
    build_salary_workbook,
    build_summary_workbook,
)

REPORT_SUMMARY = 'summary'
REPORT_SALARY = 'salary'
REPORT_TYPES = (REPORT_SUMMARY, REPORT_SALARY)

_CELL_REF = r'\$?([A-Z]{1,3})\$?(\d+)'
_SUM_RE = re.compile(r'^=SUM\((.+)\)$', re.IGNORECASE)
_PRODUCT_RE = re.compile(rf'^=({_CELL_REF}|\d+(?:\.\d+)?)\*({_CELL_REF}|\d+(?:\.\d+)?)$', re.IGNORECASE)
_SINGLE_REF_RE = re.compile(rf'^{_CELL_REF}$', re.IGNORECASE)


def _is_number(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool)


class _FormulaEvaluator:
    """Evaluates the few formula shapes the report templates use: ``=SUM(...)``
    over ranges / cell lists and a two-operand product. Anything else evaluates
    to None rather than a guess."""

    def __init__(self, ws):
        self.ws = ws
        self._cache = {}
        self._in_progress = set()

    def cell_value(self, coordinate):
        coordinate = coordinate.replace('$', '').upper()
        if coordinate in self._cache:
            return self._cache[coordinate]
        if coordinate in self._in_progress:
            return None  # circular reference
        raw = self.ws[coordinate].value
        if isinstance(raw, str) and raw.startswith('='):
            self._in_progress.add(coordinate)
            try:
                value = self.evaluate(raw)
            finally:
                self._in_progress.discard(coordinate)
        else:
            value = raw
        self._cache[coordinate] = value
        return value

    def _numeric(self, coordinate):
        value = self.cell_value(coordinate)
        return float(value) if _is_number(value) else None

    def evaluate(self, formula):
        text = formula.replace(' ', '')
        match = _SUM_RE.match(text)
        if match:
            total = 0.0
            for part in match.group(1).split(','):
                if ':' in part:
                    min_col, min_row, max_col, max_row = range_boundaries(part.replace('$', '').upper())
                    for row in range(min_row, max_row + 1):
                        for col in range(min_col, max_col + 1):
                            # Like Excel's SUM, text cells contribute nothing.
                            total += self._numeric(f'{get_column_letter(col)}{row}') or 0.0
                elif _SINGLE_REF_RE.match(part):
                    total += self._numeric(part) or 0.0
                else:
                    return None
            return round(total, 2)
        match = _PRODUCT_RE.match(text)
        if match:
            operands = []
            for token in (match.group(1), match.group(4)):
                operands.append(self._numeric(token) if _SINGLE_REF_RE.match(token) else float(token))
            if None in operands:
                return None
            return round(operands[0] * operands[1], 2)
        return None


def _fill_rgb(cell):
    fill = cell.fill
    if fill is None or not fill.fill_type:
        return None
    rgb = fill.fgColor.rgb
    if not isinstance(rgb, str) or len(rgb) < 6:
        return None
    return '#' + rgb[-6:]


def _sheet_to_model(ws, day_cells, max_row):
    """Serialize ``ws`` (rows 1..max_row). ``day_cells`` maps (row, col) to
    (employee_id, day) for the per-day cells."""
    evaluator = _FormulaEvaluator(ws)
    max_col = ws.max_column
    cells = []
    used_cols = 1
    for row in range(1, max_row + 1):
        for col in range(1, max_col + 1):
            cell = ws.cell(row=row, column=col)
            key = day_cells.get((row, col))
            raw = cell.value
            if raw == '':
                raw = None
            is_formula = isinstance(raw, str) and raw.startswith('=')
            note = cell.comment.text if cell.comment is not None else None
            fill = _fill_rgb(cell)
            if key is None and raw is None and note is None and fill is None:
                continue
            entry = {
                'row': row,
                'col': col,
                'value': evaluator.cell_value(cell.coordinate) if is_formula else raw,
                'kind': 'input' if key is not None else ('calculated' if is_formula else 'protected'),
            }
            if key is not None:
                entry['employee_id'], entry['day'] = key
            if is_formula:
                entry['formula'] = raw
            if note:
                entry['note'] = note
            if fill:
                entry['fill'] = fill
            if cell.font is not None and cell.font.b:
                entry['bold'] = True
            if cell.number_format and cell.number_format != 'General':
                entry['number_format'] = cell.number_format
            cells.append(entry)
            used_cols = max(used_cols, col)
    return {
        'sheet_title': ws.title,
        'rtl': bool(ws.sheet_view.rightToLeft),
        'row_count': max_row,
        'col_count': used_cols,
        'col_widths': {
            str(idx): ws.column_dimensions[get_column_letter(idx)].width
            for idx in range(1, used_cols + 1)
            if get_column_letter(idx) in ws.column_dimensions
            and ws.column_dimensions[get_column_letter(idx)].width is not None
        },
        'cells': cells,
    }


def _employee_entry(employee, **position):
    return {
        'id': str(employee.id),
        'full_name': employee.full_name,
        'passport_id': employee.passport_id,
        **position,
    }


def build_summary_report_model(site, site_data, month, other_site_labels=None):
    """Model of the single-site Summary report. ``site_data`` is one site's entry
    from ``load_hours_matrix_for_sites``. ``other_site_labels`` names the other
    site on days worked elsewhere, exactly as the export does when asked to."""
    employees = site_data['employees']
    workbook = build_summary_workbook(
        site,
        employees,
        site_data['matrix'],
        month,
        site_data['status_matrix'],
        site_data.get('monthly_totals'),
        site_data.get('comment_matrix'),
        site_data.get('other_site_days'),
        other_site_labels,
    )
    ws = workbook.worksheets[0]
    days_in_month = calendar.monthrange(month.year, month.month)[1]

    # Layout written by _populate_template_core_sheet: employee N is column N+2,
    # day D is row D+2, the total row follows the last day, then the tariff block.
    day_cells = {}
    for idx, employee in enumerate(employees):
        for day in range(1, days_in_month + 1):
            day_cells[(day + 2, idx + 2)] = (str(employee.id), day)
    total_row = days_in_month + 3

    model = _sheet_to_model(ws, day_cells, max_row=total_row + 4)
    model.update({
        'report_type': REPORT_SUMMARY,
        'orientation': 'employees_as_columns',
        'days_in_month': days_in_month,
        'total_row': total_row,
        'employees': [
            _employee_entry(employee, col=idx + 2) for idx, employee in enumerate(employees)
        ],
        'other_site_days': site_data.get('other_site_days') or {},
        # The text shown for each day worked elsewhere (generic unless named).
        'other_site_labels': {
            employee_key: {
                str(day): (other_site_labels or {}).get(employee_key, {}).get(day) or OTHER_SITE_LABEL
                for day in days
            }
            for employee_key, days in (site_data.get('other_site_days') or {}).items()
        },
        'monthly_total_overrides': sorted((site_data.get('monthly_totals') or {}).keys()),
    })
    return model


def build_salary_report_model(site, site_data, month):
    """Model of the single-site Salary report. ``site_data`` is one site's entry
    from ``load_hours_matrix_for_sites``."""
    employees = site_data['employees']
    workbook = build_salary_workbook(
        site,
        employees,
        site_data['matrix'],
        month,
        site_data['status_matrix'],
        site_data.get('comment_matrix'),
    )
    ws = workbook.worksheets[0]
    days_in_month = calendar.monthrange(month.year, month.month)[1]

    # Layout written by _populate_salary_template_sheet: employee N is row N+2,
    # day columns come from the (rewritten) header row.
    day_columns = _extract_salary_day_columns_map(ws, month)
    day_cells = {}
    for idx, employee in enumerate(employees):
        for day, col in day_columns.items():
            day_cells[(idx + 2, col)] = (str(employee.id), day)

    model = _sheet_to_model(ws, day_cells, max_row=ws.max_row)
    model.update({
        'report_type': REPORT_SALARY,
        'orientation': 'employees_as_rows',
        'days_in_month': days_in_month,
        'instruction_row': _find_salary_instruction_row(ws),
        'employees': [
            _employee_entry(employee, row=idx + 2) for idx, employee in enumerate(employees)
        ],
    })
    return model


def build_report_model(report_type, site, site_data, month, other_site_labels=None):
    if report_type == REPORT_SUMMARY:
        return build_summary_report_model(site, site_data, month, other_site_labels)
    if report_type == REPORT_SALARY:
        return build_salary_report_model(site, site_data, month)
    raise ValueError(f'Unknown report type: {report_type}')
