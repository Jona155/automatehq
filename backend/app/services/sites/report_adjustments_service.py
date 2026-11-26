"""The site report editor: preview payload, saving edits, and report notes.

Edits made in the report are written straight into the attendance data — the
work card day entries the rest of the system reads — exactly like an edit in
the work card review screen. The report, the review screen, analytics, absences
and the missing-cards view therefore always agree. Filling days for an employee
who has no work card that month creates a manual card to hold them.

Two things stay report-only:
  * report notes — recipient-facing text exported as Excel cell notes;
  * LEGACY adjustments — edits saved by the first version of the editor, which
    layered them over the data instead of changing it. A legacy adjustment
    keeps applying as an overlay on the report path (preview + Summary/Salary
    exports) until it is migrated into the day entries and stamped
    ``migrated_at``: by ``flask report-edits migrate``, or by the first save of
    its site-month. No new adjustments are ever created.

The editor is gated by ``REPORT_EDITOR_ENABLED``. When it is off no adjustment
or note query runs.
"""
import calendar
import os
from datetime import datetime

from sqlalchemy.dialects.postgresql import insert as pg_insert

from ...extensions import db
from ...models.audit import AuditEvent
from ...models.report_adjustments import ReportAdjustment, ReportNote, ReportRevision
from ...models.users import User
from ...models.work_cards import WorkCard, WorkCardDayEntry, day_entry_has_data
from ...utils import utc_now
from .report_export import (
    OTHER_SITE_LABEL,
    OTHER_SITE_NAMED_PREFIX,
    STATUS_DAY_LABELS,
    load_hours_matrix_for_sites,
    other_site_labels_for_site,
)
from .report_model import REPORT_SALARY, REPORT_SUMMARY, REPORT_TYPES, build_report_model

MAX_NOTE_LENGTH = 2000
MANUAL_CARD_SOURCE = 'MANUAL'
HUMAN_ENTRY_SOURCE = 'MANUAL'
OTHER_SITE_DAY_MESSAGE = 'יום זה רשום לעובד באתר אחר. יש לערוך אותו בדוח של אותו אתר.'
STALE_VALUE_MESSAGE = 'הערך בתא השתנה במקום אחר במערכת מאז שהדוח נפתח. יש לרענן את הדוח ולנסות שוב.'
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


class DayWriteBlocked(Exception):
    """This employee-day cannot be changed from this site's report."""


class MigrationMismatch(Exception):
    """Migrating legacy adjustments would have changed what the report shows."""

    def __init__(self, differences):
        super().__init__('Report changed while migrating adjustments')
        self.differences = differences


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

def overlay_site_results(site_results, business_id, month, report_type=None, force=False):
    """Apply not-yet-migrated legacy adjustments (and, for ``report_type``, saved
    notes) onto the loader's per-site results, in place. ``force`` applies them
    even with the editor switched off (used by the migration itself).

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
    if not site_results or not (force or is_enabled()):
        return site_results

    site_ids = list(site_results.keys())
    adjustments = ReportAdjustment.query.filter(
        ReportAdjustment.business_id == business_id,
        ReportAdjustment.processing_month == month,
        ReportAdjustment.site_id.in_(site_ids),
        ReportAdjustment.migrated_at.is_(None),
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
    """The hours matrix for ``site_ids`` as the given report shows it: the
    attendance data plus report notes and any legacy adjustments still waiting
    to be migrated. Raises if those cannot be loaded — a report must never go
    out silently missing saved changes."""
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


# --- writing into the attendance data ----------------------------------------

def _audit(business_id, site_id, employee_id, user_id, event_type, metadata, work_card_id=None):
    db.session.add(AuditEvent(
        business_id=business_id,
        actor_user_id=user_id,
        event_type=event_type,
        entity_type='SITE_REPORT',
        entity_id=site_id,
        site_id=site_id,
        employee_id=employee_id,
        work_card_id=work_card_id,
        event_metadata=metadata,
    ))


def _report_rank(card):
    """The order the report loader picks an employee's card in: approved first,
    then the newest (see ``load_hours_matrix_for_sites``)."""
    created = card.created_at.timestamp() if card.created_at else 0
    return (0 if card.review_status == 'APPROVED' else 1, -created)


class _DayWriter:
    """Writes report values into work card day entries for one site-month.

    A report cell shows one day entry of the card the report picks for that
    employee, so that is the entry a new value goes into. An employee with no
    card at all gets a manual card at this site.

    The card's approval is deliberately left alone (the review screen un-approves
    an edited card): the report prefers approved cards, so un-approving one here
    could make the report fall back to an older card's data right after a save.
    """

    def __init__(self, business_id, site, month, employee_ids):
        self.business_id = business_id
        self.site = site
        self.month = month
        self.cards = {}
        self.created_cards = []
        cards = []
        if employee_ids:
            cards = WorkCard.query.filter(
                WorkCard.business_id == business_id,
                WorkCard.processing_month == month,
                WorkCard.employee_id.in_(list(employee_ids)),
            ).all()
        for card in sorted(cards, key=_report_rank):
            self.cards.setdefault(card.employee_id, card)

    def write(self, employee_id, day, value, user_id):
        """Make ``value`` the employee's day at this site. Returns the card.
        Raises DayWriteBlocked, before changing anything, when the day holds
        another site's data."""
        card = self.cards.get(employee_id)
        entry = None
        if card is not None:
            entry = WorkCardDayEntry.query.filter_by(work_card_id=card.id, day_of_month=day).first()
            if entry is not None and day_entry_has_data(entry):
                if (entry.attributed_site_id or card.site_id) != self.site.id:
                    raise DayWriteBlocked(OTHER_SITE_DAY_MESSAGE)

        has_value = value['status'] is not None or value['hours'] is not None
        if entry is None and not has_value:
            return card  # nothing recorded and nothing to record

        if card is None:
            card = WorkCard(
                business_id=self.business_id, site_id=self.site.id, employee_id=employee_id,
                processing_month=self.month, source=MANUAL_CARD_SOURCE,
                uploaded_by_user_id=user_id, review_status='NEEDS_REVIEW',
            )
            db.session.add(card)
            db.session.flush()
            self.cards[employee_id] = card
            self.created_cards.append(card)
            _audit(self.business_id, self.site.id, employee_id, user_id, 'REPORT_MANUAL_CARD_CREATED', {
                'processing_month': self.month.strftime('%Y-%m'),
            }, work_card_id=card.id)

        if entry is None:
            entry = WorkCardDayEntry(work_card_id=card.id, day_of_month=day)
            db.session.add(entry)
        # The report holds a day total, not clock times: stale from/to times
        # would contradict the new figure in the review screen.
        entry.from_time = None
        entry.to_time = None
        entry.total_hours = value['hours']
        entry.day_status = value['status']
        # A human save is authoritative: later automatic extraction and
        # approval consolidation never overwrite it (same as a review-screen save).
        entry.source = HUMAN_ENTRY_SOURCE
        entry.is_valid = True
        entry.validation_errors = None
        entry.updated_by_user_id = user_id
        # NULL means "the card's own site"; only a genuine cross-site day is stored.
        entry.attributed_site_id = None if card.site_id == self.site.id else self.site.id
        if has_value and card.review_status == 'APPROVED':
            # Keep the approved card's protected range covering every day it holds.
            card.approved_through_day = max(card.approved_through_day or 0, day)
        db.session.flush()
        return card


# --- legacy adjustments -> day entries ---------------------------------------

def _load_source(business_id, site, month):
    """Attendance data for the site-month with every employee any report shows."""
    return load_hours_matrix_for_sites(
        site_ids=[site.id], processing_month=month.strftime('%Y-%m-%d'),
        approved_only=False, include_inactive=True, business_id=business_id,
    )[site.id]


def _shown_values(business_id, site, month):
    """Every non-blank employee-day the reports show for the site-month, legacy
    adjustments included: {(employee_id, day): value}."""
    site_data = load_hours_matrix_for_sites(
        site_ids=[site.id], processing_month=month.strftime('%Y-%m-%d'),
        approved_only=False, include_inactive=True, business_id=business_id,
    )
    site_data = overlay_site_results(site_data, business_id, month, force=True)[site.id]
    shown = {}
    for employee_key, per_day in site_data['matrix'].items():
        for day, hours in per_day.items():
            shown[(employee_key, day)] = _normalise_value({'hours': hours})
    for employee_key, per_day in site_data['status_matrix'].items():
        for day, status in per_day.items():
            shown[(employee_key, day)] = {'hours': None, 'status': status}
    return shown


def pending_adjustment_groups(business_id=None):
    """(business_id, site_id, month) of every site-month with legacy adjustments
    not yet migrated."""
    query = db.session.query(
        ReportAdjustment.business_id, ReportAdjustment.site_id, ReportAdjustment.processing_month,
    ).filter(ReportAdjustment.migrated_at.is_(None))
    if business_id is not None:
        query = query.filter(ReportAdjustment.business_id == business_id)
    return query.distinct().order_by(
        ReportAdjustment.business_id, ReportAdjustment.processing_month, ReportAdjustment.site_id,
    ).all()


def apply_pending_adjustments(business_id, site, month):
    """Write the site-month's not-yet-migrated legacy adjustments into the work
    card day entries and stamp them migrated. Stages changes in the current
    transaction; the caller commits or rolls back.

    The reports must come out identical before and after: the values they show
    are compared, and ``MigrationMismatch`` is raised if anything moved (the
    caller must then roll back).

    Returns one outcome dict per adjustment:
      applied              written into the day entries
      already_matches      the data already holds this value; just stamped
      skipped_not_in_report  the employee is in no report of this site-month
                           (not applied today either) — left as is
      blocked              the day holds another site's data — left as an
                           overlay, so the report keeps showing it
    """
    pending = ReportAdjustment.query.filter(
        ReportAdjustment.site_id == site.id,
        ReportAdjustment.processing_month == month,
        ReportAdjustment.migrated_at.is_(None),
    ).order_by(ReportAdjustment.employee_id, ReportAdjustment.day_of_month).all()
    if not pending:
        return []

    before = _shown_values(business_id, site, month)
    source = _load_source(business_id, site, month)
    employees = {str(emp.id): emp for emp in source['employees']}
    writer = _DayWriter(business_id, site, month, [emp.id for emp in employees.values()])
    month_label = month.strftime('%Y-%m')
    now = utc_now()

    outcomes = []
    for adjustment in pending:
        employee_key = str(adjustment.employee_id)
        employee = employees.get(employee_key)
        value = _adjustment_value(adjustment)
        outcome = {
            'employee_id': employee_key,
            'employee_name': employee.full_name if employee else None,
            'day': adjustment.day_of_month,
            'value': value,
            'previous': None,
            'created_manual_card': False,
        }
        outcomes.append(outcome)
        if employee is None:
            outcome['outcome'] = 'skipped_not_in_report'
            continue
        current = source_value(source, employee_key, adjustment.day_of_month)
        outcome['previous'] = current
        if current == value:
            adjustment.migrated_at = now
            outcome['outcome'] = 'already_matches'
            continue
        cards_before = len(writer.created_cards)
        try:
            card = writer.write(employee.id, adjustment.day_of_month, value, adjustment.updated_by_user_id)
        except DayWriteBlocked:
            outcome['outcome'] = 'blocked'
            continue
        adjustment.migrated_at = now
        outcome['outcome'] = 'applied'
        outcome['created_manual_card'] = len(writer.created_cards) > cards_before
        _audit(business_id, site.id, employee.id, adjustment.updated_by_user_id, 'REPORT_ADJUSTMENT_MIGRATED', {
            'processing_month': month_label, 'day': adjustment.day_of_month,
            'previous_value': current, 'new_value': value,
        }, work_card_id=card.id if card else None)

    db.session.flush()
    after = _shown_values(business_id, site, month)
    if before != after:
        raise MigrationMismatch([
            {'employee_id': key[0], 'day': key[1], 'before': before.get(key), 'after': after.get(key)}
            for key in sorted(set(before) | set(after), key=lambda k: (k[0], k[1]))
            if before.get(key) != after.get(key)
        ])
    return outcomes


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


def save_report_changes(*, business_id, site, month, report_type, base_revision, cells, notes, user_id):
    """Persist a batch of cell and note changes atomically.

    ``cells``: [{employee_id, day, value, expected?}] writes the value into the
    employee's work card day entry. ``expected`` is the value the editor was
    showing; when given and the data has changed since, the cell is rejected
    instead of overwriting someone else's edit. ``{.., reset: true}`` drops a
    legacy adjustment that could not be migrated (there is no other "original"
    to reset to any more).
    ``notes``: [{employee_id, day, text}]; empty text removes the note.

    All-or-nothing: on a validation error or a revision mismatch nothing is
    written. Returns ``{'revision', 'created_manual_cards'}``.
    """
    if report_type not in REPORT_TYPES:
        raise ValueError(f'Unknown report type: {report_type}')
    if not isinstance(cells, list) or not isinstance(notes, list):
        raise ReportValidationError([{'message': 'cells and notes must be lists'}])

    try:
        revision = _lock_revision(business_id, site.id, month)
        if revision.revision != base_revision:
            raise ReportConflict(revision.revision)

        # Edits saved by the old editor become real data first, so everything
        # below works against one source of truth.
        migrated = apply_pending_adjustments(business_id, site, month)
        changed = any(item['outcome'] in ('applied', 'already_matches') for item in migrated)

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
        # Legacy adjustments that could not be migrated still overlay the report.
        leftover = {
            (str(adj.employee_id), adj.day_of_month): adj
            for adj in ReportAdjustment.query.filter(
                ReportAdjustment.site_id == site.id,
                ReportAdjustment.processing_month == month,
                ReportAdjustment.migrated_at.is_(None),
            ).all()
        }

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
                value = parse_cell_value(item.get('value'))
                # A cell under a leftover legacy adjustment shows that value, not
                # the data, so there is nothing meaningful to compare against.
                if 'expected' in item and located not in leftover:
                    if parse_cell_value(item.get('expected')) != source_value(site_data, *located):
                        raise ValueError(STALE_VALUE_MESSAGE)
                parsed_cells[located] = value
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

        month_label = month.strftime('%Y-%m')
        writer = _DayWriter(business_id, site, month, [emp.id for emp in employees.values()])

        for (employee_key, day), new_value in parsed_cells.items():
            employee = employees[employee_key]
            source = source_value(site_data, employee_key, day)
            adjustment = leftover.get((employee_key, day))
            shown = _adjustment_value(adjustment) if adjustment else source
            if adjustment is not None:
                # The user's decision replaces the legacy adjustment either way.
                db.session.delete(adjustment)
                changed = True
            target = source if new_value is None else new_value
            if target != source:
                try:
                    card = writer.write(employee.id, day, target, user_id)
                except DayWriteBlocked as exc:
                    errors.append({'employee_id': employee_key, 'day': day, 'message': str(exc)})
                    continue
                changed = True
            elif adjustment is None:
                continue
            else:
                card = writer.cards.get(employee.id)
            _audit(business_id, site.id, employee.id, user_id, 'REPORT_DAY_EDIT', {
                'processing_month': month_label, 'day': day, 'report_type': report_type,
                'previous_value': shown, 'new_value': target,
            }, work_card_id=card.id if card else None)

        if errors:
            raise ReportValidationError(errors)

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
        result = {'revision': revision.revision, 'created_manual_cards': len(writer.created_cards)}
        db.session.commit()
        return result
    except Exception:
        db.session.rollback()
        raise
