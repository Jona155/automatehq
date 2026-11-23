"""Fixtures and workbook snapshotting for the report golden tests.

The golden files in ``backend/tests/golden/`` were generated from the report
code as it stood before generation moved out of ``api/sites.py``. They pin the
exact XLSX output (values, formulas, notes, fills, formats, layout) so that
refactors of the report pipeline cannot silently change what users download.

No database is involved: employees and sites are plain namespaces.
"""
import json
import uuid
from datetime import date
from io import BytesIO
from pathlib import Path
from types import SimpleNamespace

from openpyxl import load_workbook

GOLDEN_DIR = Path(__file__).resolve().parent / 'golden'

STATUSES = ['VACATION', 'SICK', 'INTERNATIONAL_VISA', 'HOLIDAY']


def _uid(n):
    return uuid.UUID(int=n)


def make_employees(count, offset=0):
    employees = []
    for i in range(count):
        n = offset + i + 1
        employees.append(SimpleNamespace(
            id=_uid(1000 + n),
            passport_id=None if n % 11 == 0 else f'P{n:05d}',
            full_name=f'עובד{n} משפחה{n}' if n % 2 else f'Worker{n} Last{n}',
        ))
    return employees


def make_site_data(employees, days_in_month):
    """Deterministic matrix covering hours, long days, statuses, comments,
    other-site markers (alone and alongside hours) and a monthly override."""
    matrix, status_matrix, comment_matrix = {}, {}, {}
    other_site_days, other_site_ids, monthly_totals = {}, {}, {}
    for i, emp in enumerate(employees):
        key = str(emp.id)
        for day in range(1, days_in_month + 1):
            if (i + day) % 5 == 0:
                continue  # blank day
            if (i * 3 + day) % 13 == 0:
                status_matrix.setdefault(key, {})[day] = STATUSES[(i + day) % 4]
            else:
                hours = ((i * 7 + day * 3) % 9) + 5
                if (i + day) % 4 == 0:
                    hours += 0.5
                if (i + day) % 17 == 0:
                    hours = 13.25  # long day
                matrix.setdefault(key, {})[day] = float(hours)
            if (i + day) % 9 == 0:
                comment_matrix.setdefault(key, {})[day] = f'הערה ליום {day}'
        if i % 3 == 1:
            # Day 5 is usually blank for this employee -> marker in the cell;
            # day 6 has hours -> marker goes to the note.
            days = [d for d in (5 - i % 5 if 5 - i % 5 > 0 else 5, 6, 10) if d <= days_in_month]
            other_site_days[key] = sorted(set(days))
            other_site_ids[key] = {d: [_uid(9000 + d)] for d in other_site_days[key]}
        if i % 4 == 2:
            monthly_totals[key] = 187.5
    return {
        'employees': employees,
        'matrix': matrix,
        'status_map': {},
        'status_matrix': status_matrix,
        'monthly_totals': monthly_totals,
        'comment_matrix': comment_matrix,
        'other_site_days': other_site_days,
        'other_site_ids': other_site_ids,
    }


def make_site(n, name, tariff):
    return SimpleNamespace(id=_uid(n), site_name=name, hourly_tariff=tariff)


def days_in(month):
    import calendar
    return calendar.monthrange(month.year, month.month)[1]


# name -> (month, employee_count, hourly_tariff)
SINGLE_CASES = {
    'feb_3emp_tariff': (date(2026, 2, 1), 3, 78.5),
    'jan_9emp_tariff': (date(2026, 1, 1), 9, 64),
    'apr_4emp_no_tariff': (date(2026, 4, 1), 4, None),
    'mar_25emp_tariff': (date(2026, 3, 1), 25, 55.25),
    'feb_empty_tariff': (date(2026, 2, 1), 0, 70),
}


def single_case(name):
    month, count, tariff = SINGLE_CASES[name]
    site = make_site(1, 'אתר | בדיקה/ראשי', tariff)
    return site, month, make_site_data(make_employees(count), days_in(month))


def batch_case(month=date(2026, 1, 1)):
    """Three sites: one busy, one small, one empty. Returns (sites, site_matrices,
    other_site_labels) in the shapes the batch export routes use."""
    dim = days_in(month)
    sites = [
        make_site(11, 'אלפא', 64),
        make_site(12, 'בטא ארוך מאוד שם אתר שחורג משלושים ואחד תווים', None),
        make_site(13, 'גמא', 80),
    ]
    data = {
        sites[0].id: make_site_data(make_employees(9), dim),
        sites[1].id: make_site_data(make_employees(3, offset=20), dim),
        sites[2].id: make_site_data([], dim),
    }
    labels = {
        site_id: {
            emp_key: {day: f'עבד באתר: אתר{day}' for day in per_day}
            for emp_key, per_day in site_data['other_site_ids'].items()
        }
        for site_id, site_data in data.items()
    }
    return sites, data, labels


# --- snapshotting -----------------------------------------------------------

def _side(side):
    return (side.style or '-')[0] if side is not None else '-'


def _cell_snapshot(cell):
    out = {}
    if cell.value is not None:
        out['v'] = cell.value
    if cell.comment is not None:
        out['note'] = cell.comment.text
        out['note_author'] = cell.comment.author
    fill = cell.fill
    if fill is not None and fill.fill_type:
        out['fill'] = str(fill.fgColor.rgb)
    if cell.number_format != 'General':
        out['fmt'] = cell.number_format
    font = cell.font
    if font is not None and font.b:
        out['bold'] = True
    border = cell.border
    if border is not None:
        sides = _side(border.left) + _side(border.right) + _side(border.top) + _side(border.bottom)
        if sides != '----':
            out['border'] = sides
    align = cell.alignment
    if align is not None and align.horizontal:
        out['align'] = align.horizontal
    return out


def snapshot_workbook(workbook):
    """Snapshot a workbook as the recipient gets it (after a save/load round trip)."""
    buffer = BytesIO()
    workbook.save(buffer)
    buffer.seek(0)
    return snapshot_bytes(buffer.read())


def snapshot_bytes(data):
    workbook = load_workbook(BytesIO(data))
    sheets = []
    for ws in workbook.worksheets:
        cells = {}
        for row in ws.iter_rows():
            for cell in row:
                snap = _cell_snapshot(cell)
                if snap:
                    cells[cell.coordinate] = snap
        sheets.append({
            'title': ws.title,
            'rtl': bool(ws.sheet_view.rightToLeft),
            'freeze': ws.freeze_panes,
            'dimensions': ws.dimensions,
            'col_widths': {
                letter: dim.width
                for letter, dim in sorted(ws.column_dimensions.items())
                if dim.width is not None
            },
            'row_heights': {
                str(idx): dim.height
                for idx, dim in sorted(ws.row_dimensions.items())
                if dim.height is not None
            },
            'cells': cells,
        })
    return {'sheets': sheets}


def golden_path(name):
    return GOLDEN_DIR / f'{name}.json'


def write_golden(name, snapshot):
    GOLDEN_DIR.mkdir(exist_ok=True)
    golden_path(name).write_text(
        json.dumps(snapshot, ensure_ascii=False, indent=1, sort_keys=True) + '\n',
        encoding='utf-8',
    )


def read_golden(name):
    return json.loads(golden_path(name).read_text(encoding='utf-8'))


def normalise(snapshot):
    """Round-trip through JSON so tuples/ints compare equal to the stored form."""
    return json.loads(json.dumps(snapshot, ensure_ascii=False, sort_keys=True))
