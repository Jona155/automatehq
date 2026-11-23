import uuid

from sqlalchemy import Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB

from ..extensions import db
from ..utils import utc_now


class ReportAdjustment(db.Model):
    """A saved correction to one employee-day value in a site's monthly reports.

    Adjustments sit on top of the attendance data: the work card day entries
    are never modified. The same adjustment feeds both the Summary and the
    Salary report. ``hours`` and ``day_status`` both NULL means "show this day
    as blank".

    ``base_value`` records the source value the adjustment was made against
    (``{"hours": .., "status": ..}``), so a later change to the source data can
    be detected and surfaced for review instead of silently winning or losing.
    """
    __tablename__ = 'report_adjustments'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_id = db.Column(UUID(as_uuid=True), db.ForeignKey('businesses.id'), nullable=False)
    site_id = db.Column(UUID(as_uuid=True), db.ForeignKey('sites.id', ondelete='CASCADE'), nullable=False)
    processing_month = db.Column(db.Date, nullable=False)
    employee_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('employees.id', ondelete='CASCADE'), nullable=False
    )
    day_of_month = db.Column(db.SmallInteger, nullable=False)
    hours = db.Column(db.Numeric(5, 2), nullable=True)
    day_status = db.Column(db.Text, nullable=True)
    base_value = db.Column(JSONB, nullable=False, default=dict, server_default='{}')
    updated_by_user_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.id', ondelete='SET NULL'), nullable=True
    )
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    __table_args__ = (
        UniqueConstraint(
            'site_id', 'processing_month', 'employee_id', 'day_of_month',
            name='uq_report_adjustments_site_month_employee_day',
        ),
        db.CheckConstraint('day_of_month >= 1 AND day_of_month <= 31', name='check_report_adjustments_day'),
        Index('ix_report_adjustments_business_month', 'business_id', 'processing_month'),
    )


class ReportNote(db.Model):
    """A recipient-facing note on one employee-day cell of one report type.
    Exported as a native Excel cell note."""
    __tablename__ = 'report_notes'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_id = db.Column(UUID(as_uuid=True), db.ForeignKey('businesses.id'), nullable=False)
    site_id = db.Column(UUID(as_uuid=True), db.ForeignKey('sites.id', ondelete='CASCADE'), nullable=False)
    processing_month = db.Column(db.Date, nullable=False)
    report_type = db.Column(db.Text, nullable=False)  # 'summary' | 'salary'
    employee_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('employees.id', ondelete='CASCADE'), nullable=False
    )
    day_of_month = db.Column(db.SmallInteger, nullable=False)
    text = db.Column(db.Text, nullable=False)
    updated_by_user_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.id', ondelete='SET NULL'), nullable=True
    )
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    __table_args__ = (
        UniqueConstraint(
            'site_id', 'processing_month', 'report_type', 'employee_id', 'day_of_month',
            name='uq_report_notes_site_month_type_employee_day',
        ),
        db.CheckConstraint('day_of_month >= 1 AND day_of_month <= 31', name='check_report_notes_day'),
        Index('ix_report_notes_business_month', 'business_id', 'processing_month'),
    )


class ReportRevision(db.Model):
    """Save counter per site-month. An editor must present the revision it
    loaded; a mismatch means someone else saved in the meantime."""
    __tablename__ = 'report_revisions'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_id = db.Column(UUID(as_uuid=True), db.ForeignKey('businesses.id'), nullable=False)
    site_id = db.Column(UUID(as_uuid=True), db.ForeignKey('sites.id', ondelete='CASCADE'), nullable=False)
    processing_month = db.Column(db.Date, nullable=False)
    revision = db.Column(db.Integer, nullable=False, default=0, server_default='0')
    updated_by_user_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.id', ondelete='SET NULL'), nullable=True
    )
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    __table_args__ = (
        UniqueConstraint('site_id', 'processing_month', name='uq_report_revisions_site_month'),
    )
