"""Saved report adjustments and notes: loading, overlaying and saving.

Adjustments are an overlay on the hours matrix. They are applied only on the
report path (preview + Summary/Salary exports); the matrix loader itself, and
everything else that reads it (analytics, absences, the on-screen summary tab),
keeps seeing source attendance data.

The whole feature is gated by ``REPORT_EDITOR_ENABLED``. When it is off no
adjustment query runs and reports are exactly the source data.
"""
import calendar
import os
from datetime import datetime

from sqlalchemy.dialects.postgresql import insert as pg_insert

from ...extensions import db
from ...models.audit import AuditEvent
from ...models.report_adjustments import ReportAdjustment, ReportNote, ReportRevision
from ...models.users import User
from .report_export import (
    OTHER_SITE_LABEL,
    OTHER_SITE_NAMED_PREFIX,
    STATUS_DAY_LABELS,
    load_hours_matrix_for_sites,
    other_site_labels_for_site,
)
from .report_model import REPORT_SALARY, REPORT_SUMMARY, REPORT_TYPES, build_report_model

MAX_NOTE_LENGTH = 2000
SATURDAY_LABEL = 'שבת'
_STATUS_BY_LABEL = {label: code for code, label in STATUS_DAY_LABELS.items()}

# How each report is loaded everywhere it is produced. The preview must use the
# same options as the downloads or it would show different employees.
REPORT_LOAD_OPTIONS = {
    REPORT_SUMMARY: {'approved_only': False, 'include_inactive': False},
    REPORT_SALARY: {'approved_only': False, 'include_inactive': True},
}


class ReportConflict(Exception):
    """The report was saved by someone else since the editor loaded it."""

    def __init__(self, current_revision):
        super().__init__('Report was modified by another user')
        self.current_revision = current_revision


class ReportValidationError(Exception):
    """One or more submitted cells/notes are invalid. Nothing was saved."""

    def __init__(self, errors):
        super().__init__('Invalid report changes')
        self.errors = errors


def is_enabled():
    return os.environ.get('REPORT_EDITOR_ENABLED', 'false').strip().lower() in ('1', 'true', 'yes', 'on')


# --- values -----------------------------------------------------------------

def _blank():
    return {'hours': None, 'status': None}


def _normalise_value(value):
    value = value or {}
    hours = value.get('hours')
    status = value.get('status') or None
    if status:
        return {'hours': None, 'status': status}
    return {'hours': round(float(hours), 2) if hours is not None else None, 'status': None}


def source_value(site_data, employee_key, day):
    """The value the source attendance data gives this employee-day."""
    status = site_data['status_matrix'].get(employee_key, {}).get(day)
    if status:
        return {'hours': None, 'status': status}
    hours = site_data['matrix'].get(employee_key, {}).get(day)
    return _normalise_value({'hours': hours})


def _adjustment_value(adjustment):
    return _normalise_value({
        'hours': float(adjustment.hours) if adjustment.hours is not None else None,
        'status': adjustment.day_status,
    })


def _write_value(site_data, employee_key, day, value):
    site_data['matrix'].get(employee_key, {}).pop(day, None)
    site_data['status_matrix'].get(employee_key, {}).pop(day, None)
    if value['status']:
        site_data['status_matrix'].setdefault(employee_key, {})[day] = value['status']
    elif value['hours'] is not None:
        site_data['matrix'].setdefault(employee_key, {})[day] = value['hours']


def parse_cell_value(raw):
    """Turn what a user typed/pasted into a value dict. Raises ValueError with a
    user-facing (Hebrew) message when it is not a valid day value."""
    if raw is None:
        return _blank()
    if isinstance(raw, bool):
        raise ValueError('ערך לא תקין')
    if isinstance(raw, (int, float)):
        hours = float(raw)
    else:
        text = str(raw).strip()
        if not text or text == SATURDAY_LABEL or text == OTHER_SITE_LABEL or text.startswith(OTHER_SITE_NAMED_PREFIX):
            return _blank()
        if text in STATUS_DAY_LABELS:
            return {'hours': None, 'status': text}
        if text in _STATUS_BY_LABEL:
            return {'hours': None, 'status': _STATUS_BY_LABEL[text]}
        try:
            hours = float(text.replace(',', '.'))
        except ValueError:
            raise ValueError(
                'ערך לא תקין: יש להזין מספר שעות או סטטוס ('
                + ' / '.join(STATUS_DAY_LABELS.values()) + ')'
            )
    if hours != hours or hours in (float('inf'), float('-inf')):
        raise ValueError('ערך לא תקין')
    if hours < 0 or hours > 24:
        raise ValueError('מספר השעות חייב להיות בין 0 ל-24')
    return {'hours': round(hours, 2), 'status': None}


# --- overlay ----------------------------------------------------------------

def overlay_site_results(site_results, business_id, month, report_type=None):
    """Apply saved adjustments (and, for ``report_type``, saved notes) onto the
    loader's per-site results, in place.

    Adds to each site's data:
      ``report_adjustments`` {employee_key: {day: {value, source, conflict, ...}}}
      ``report_notes``       {employee_key: {day: text}}
      ``day_comments``       the review comments as they were before notes merged in
      ``orphan_adjustments`` adjustments whose employee is no longer in the report

    Adjustments are matched by employee and day only — never by position — and
    one that no longer has a home is left unapplied rather than moved.
    """
    for site_data in site_results.values():
        site_data['report_adjustments'] = {}
        site_data['report_notes'] = {}
        site_data['orphan_adjustments'] = []
        site_data['day_comments'] = {
            key: dict(days) for key, days in site_data.get('comment_matrix', {}).items()
        }
    if not site_results or not is_enabled():
        return site_results

    site_ids = list(site_results.keys())
    adjustments = ReportAdjustment.query.filter(
        ReportAdjustment.business_id == business_id,
        ReportAdjustment.processing_month == month,
        ReportAdjustment.site_id.in_(site_ids),
    ).all()

    employee_keys = {
        site_id: {str(emp.id) for emp in site_data['employees']}
        for site_id, site_data in site_results.items()
    }

    for adjustment in adjustments:
        site_data = site_results.get(adjustment.site_id)
        if site_data is None:
            continue
        employee_key = str(adjustment.employee_id)
        day = adjustment.day_of_month
        value = _adjustment_value(adjustment)
        if employee_key not in employee_keys[adjustment.site_id]:
            site_data['orphan_adjustments'].append({
                'employee_id': employee_key, 'day': day, 'value': value,
            })
            continue
        source = source_value(site_data, employee_key, day)
        site_data['report_adjustments'].setdefault(employee_key, {})[day] = {
            'value': value,
            'source': source,
            'conflict': source != _normalise_value(adjustment.base_value),
            'updated_by_user_id': str(adjustment.updated_by_user_id) if adjustment.updated_by_user_id else None,
            'updated_at': adjustment.updated_at.isoformat() if adjustment.updated_at else None,
        }
        _write_value(site_data, employee_key, day, value)

    if report_type is not None:
        notes = ReportNote.query.filter(
            ReportNote.business_id == business_id,
            ReportNote.processing_month == month,
            ReportNote.report_type == report_type,
            ReportNote.site_id.in_(site_ids),
        ).all()
        for note in notes:
            site_data = site_results.get(note.site_id)
            employee_key = str(note.employee_id)
            if site_data is None or employee_key not in employee_keys[note.site_id]:
                continue
            day = note.day_of_month
            site_data['report_notes'].setdefault(employee_key, {})[day] = note.text
            comments = site_data.setdefault('comment_matrix', {}).setdefault(employee_key, {})
            comments[day] = '\n'.join(part for part in (comments.get(day), note.text) if part)

    return site_results


def load_report_site_data(site_ids, processing_month, approved_only, include_inactive, business_id, report_type):
    """The hours matrix for ``site_ids`` as the given report shows it: source
    data plus saved adjustments and notes. Raises if adjustments cannot be
    loaded — a report must never go out silently missing saved changes."""
    month = datetime.strptime(processing_month, '%Y-%m-%d').date()
    site_results = load_hours_matrix_for_sites(
        site_ids=site_ids,
        processing_month=processing_month,
        approved_only=approved_only,
        include_inactive=include_inactive,
        business_id=business_id,
    )
    return overlay_site_results(site_results, business_id, month, report_type)


# --- preview payload --------------------------------------------------------

def get_revision(site_id, month):
    row = ReportRevision.query.filter_by(site_id=site_id, processing_month=month).first()
    return row.revision if row else 0


def _flatten(per_employee, value_key):
    return [
        {'employee_id': employee_key, 'day': day, value_key: value}
        for employee_key, per_day in sorted(per_employee.items())
        for day, value in sorted(per_day.items())
    ]


def build_report_payload(site, month, report_type, business_id, show_other_site_names=False):
    if report_type not in REPORT_TYPES:
        raise ValueError(f'Unknown report type: {report_type}')
    options = REPORT_LOAD_OPTIONS[report_type]
    site_data = load_report_site_data(
        [site.id], month.strftime('%Y-%m-%d'), options['approved_only'],
        options['include_inactive'], business_id, report_type,
    )[site.id]

    adjustments = []
    user_ids = set()
    for employee_key, per_day in sorted(site_data['report_adjustments'].items()):
        for day, info in sorted(per_day.items()):
            adjustments.append({'employee_id': employee_key, 'day': day, **info})
            if info['updated_by_user_id']:
                user_ids.add(info['updated_by_user_id'])
    user_names = {}
    if user_ids:
        user_names = {
            str(user.id): user.full_name
            for user in User.query.filter(User.id.in_(list(user_ids))).all()
        }
    for entry in adjustments:
        entry['updated_by_name'] = user_names.get(entry.pop('updated_by_user_id'))

    employees = site_data['employees']
    statuses = site_data.get('status_map', {})
    # Only the Summary report marks days worked at another site.
    has_other_site_days = report_type == REPORT_SUMMARY and any(site_data.get('other_site_days', {}).values())
    show_other_site_names = bool(show_other_site_names) and report_type == REPORT_SUMMARY
    other_site_labels = (
        other_site_labels_for_site(site.id, site_data, business_id)
        if show_other_site_names and has_other_site_days else None
    )
    return {
        'site': {'id': str(site.id), 'name': site.site_name},
        'processing_month': month.strftime('%Y-%m-%d'),
        'report_type': report_type,
        'revision': get_revision(site.id, month),
        'model': build_report_model(report_type, site, site_data, month, other_site_labels),
        'has_other_site_days': has_other_site_days,
        'show_other_site_names': show_other_site_names,
        'adjustments': adjustments,
        'notes': _flatten(site_data['report_notes'], 'text'),
        'day_comments': _flatten(site_data['day_comments'], 'text'),
        'orphan_adjustments': site_data['orphan_adjustments'],
        'status_labels': STATUS_DAY_LABELS,
        'employee_count': len(employees),
        'has_unapproved_cards': any(
            statuses.get(str(emp.id)) not in (None, 'APPROVED') for emp in employees
        ),
        'load_options': options,
    }


# --- saving -----------------------------------------------------------------

def _lock_revision(business_id, site_id, month):
    """Fetch the site-month revision row with a row lock, creating it if needed.
    Serialises concurrent saves of the same report."""
    db.session.execute(
        pg_insert(ReportRevision.__table__)
        .values(business_id=business_id, site_id=site_id, processing_month=month, revision=0)
        .on_conflict_do_nothing(constraint='uq_report_revisions_site_month')
    )
    return (
        ReportRevision.query
        .filter_by(site_id=site_id, processing_month=month)
        .with_for_update()
        .one()
    )


def _audit(business_id, site_id, employee_id, user_id, event_type, metadata):
    db.session.add(AuditEvent(
        business_id=business_id,
        actor_user_id=user_id,
        event_type=event_type,
        entity_type='SITE_REPORT',
        entity_id=site_id,
        site_id=site_id,
        employee_id=employee_id,
        event_metadata=metadata,
    ))


def save_report_changes(*, business_id, site, month, report_type, base_revision, cells, notes, user_id):
    """Persist a batch of cell and note changes atomically.

    ``cells``: [{employee_id, day, value}] to set a value, or {.., reset: true}
    to drop the adjustment and fall back to source data.
    ``notes``: [{employee_id, day, text}]; empty text removes the note.

    All-or-nothing: on a validation error or a revision mismatch nothing is
    written. Returns the new revision.
    """
    if report_type not in REPORT_TYPES:
        raise ValueError(f'Unknown report type: {report_type}')
    if not isinstance(cells, list) or not isinstance(notes, list):
        raise ReportValidationError([{'message': 'cells and notes must be lists'}])

    try:
        revision = _lock_revision(business_id, site.id, month)
        if revision.revision != base_revision:
            raise ReportConflict(revision.revision)

        options = REPORT_LOAD_OPTIONS[report_type]
        site_data = load_hours_matrix_for_sites(
            site_ids=[site.id],
            processing_month=month.strftime('%Y-%m-%d'),
            approved_only=options['approved_only'],
            include_inactive=options['include_inactive'],
            business_id=business_id,
        )[site.id]
        employees = {str(emp.id): emp for emp in site_data['employees']}
        days_in_month = calendar.monthrange(month.year, month.month)[1]

        errors = []

        def locate(item):
            employee_key = str(item.get('employee_id')) if isinstance(item, dict) else None
            day = item.get('day') if isinstance(item, dict) else None
            if employee_key not in employees:
                errors.append({'employee_id': employee_key, 'day': day, 'message': 'העובד אינו מופיע בדוח זה'})
                return None
            if isinstance(day, bool) or not isinstance(day, int) or not 1 <= day <= days_in_month:
                errors.append({'employee_id': employee_key, 'day': day, 'message': 'יום לא תקין'})
                return None
            return employee_key, day

        parsed_cells = {}
        for item in cells:
            located = locate(item)
            if located is None:
                continue
            if item.get('reset'):
                parsed_cells[located] = None
                continue
            try:
                parsed_cells[located] = parse_cell_value(item.get('value'))
            except ValueError as exc:
                errors.append({'employee_id': located[0], 'day': located[1], 'message': str(exc)})

        parsed_notes = {}
        for item in notes:
            located = locate(item)
            if located is None:
                continue
            text = item.get('text')
            text = text.strip() if isinstance(text, str) else ''
            if len(text) > MAX_NOTE_LENGTH:
                errors.append({
                    'employee_id': located[0], 'day': located[1], 'field': 'note',
                    'message': f'ההערה ארוכה מדי (עד {MAX_NOTE_LENGTH} תווים)',
                })
                continue
            parsed_notes[located] = text

        if errors:
            raise ReportValidationError(errors)

        existing = {
            (str(adj.employee_id), adj.day_of_month): adj
            for adj in ReportAdjustment.query.filter_by(site_id=site.id, processing_month=month).all()
        }
        month_label = month.strftime('%Y-%m')
        changed = False

        for (employee_key, day), new_value in parsed_cells.items():
            adjustment = existing.get((employee_key, day))
            source = source_value(site_data, employee_key, day)
            old_value = _adjustment_value(adjustment) if adjustment else source
            target = source if new_value is None else new_value

            if target == source:
                # Nothing to adjust: the report should simply show source data.
                if adjustment is None:
                    continue
                db.session.delete(adjustment)
            elif adjustment is None:
                db.session.add(ReportAdjustment(
                    business_id=business_id, site_id=site.id, processing_month=month,
                    employee_id=employees[employee_key].id, day_of_month=day,
                    hours=target['hours'], day_status=target['status'],
                    base_value=source, updated_by_user_id=user_id,
                ))
            else:
                same_value = old_value == target
                same_base = _normalise_value(adjustment.base_value) == source
                if same_value and same_base:
                    continue
                # Re-saving an unchanged value against changed source data is
                # the user confirming the adjustment: it clears the conflict.
                adjustment.hours = target['hours']
                adjustment.day_status = target['status']
                adjustment.base_value = source
                adjustment.updated_by_user_id = user_id
            changed = True
            _audit(business_id, site.id, employees[employee_key].id, user_id, 'REPORT_ADJUSTMENT', {
                'processing_month': month_label, 'day': day, 'report_type': report_type,
                'previous_value': old_value, 'new_value': target, 'source_value': source,
                'reverted_to_source': target == source,
            })

        existing_notes = {
            (str(note.employee_id), note.day_of_month): note
            for note in ReportNote.query.filter_by(
                site_id=site.id, processing_month=month, report_type=report_type,
            ).all()
        }
        for (employee_key, day), text in parsed_notes.items():
            note = existing_notes.get((employee_key, day))
            old_text = note.text if note else ''
            if text == old_text:
                continue
            if not text:
                db.session.delete(note)
            elif note is None:
                db.session.add(ReportNote(
                    business_id=business_id, site_id=site.id, processing_month=month,
                    report_type=report_type, employee_id=employees[employee_key].id,
                    day_of_month=day, text=text, updated_by_user_id=user_id,
                ))
            else:
                note.text = text
                note.updated_by_user_id = user_id
            changed = True
            _audit(business_id, site.id, employees[employee_key].id, user_id, 'REPORT_NOTE', {
                'processing_month': month_label, 'day': day, 'report_type': report_type,
                'previous_text': old_text, 'new_text': text,
            })

        if changed:
            revision.revision += 1
            revision.updated_by_user_id = user_id
        new_revision = revision.revision
        db.session.commit()
        return new_revision
    except Exception:
        db.session.rollback()
        raise
