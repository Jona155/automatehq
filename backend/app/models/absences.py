import uuid

from sqlalchemy import Index, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID, JSONB

from ..extensions import db
from ..utils import utc_now


class AbsenceMonthSettings(db.Model):
    """Per business+month configuration for the absences report.

    ``ignored_days`` holds day-of-month numbers (e.g. holidays) that must not be
    counted as missed workdays even when they carry no value.
    """
    __tablename__ = 'absence_month_settings'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_id = db.Column(UUID(as_uuid=True), db.ForeignKey('businesses.id'), nullable=False)
    processing_month = db.Column(db.Date, nullable=False)
    ignored_days = db.Column(JSONB, nullable=False, default=list, server_default='[]')
    updated_by_user_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.id', ondelete='SET NULL'), nullable=True
    )
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    __table_args__ = (
        UniqueConstraint('business_id', 'processing_month', name='uq_absence_month_settings_business_month'),
    )


class AbsenceEmployeeExclusion(db.Model):
    """An employee removed from the absences view for one month."""
    __tablename__ = 'absence_employee_exclusions'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_id = db.Column(UUID(as_uuid=True), db.ForeignKey('businesses.id'), nullable=False)
    processing_month = db.Column(db.Date, nullable=False)
    employee_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('employees.id', ondelete='CASCADE'), nullable=False
    )
    reason = db.Column(db.Text, nullable=True)
    created_by_user_id = db.Column(
        UUID(as_uuid=True), db.ForeignKey('users.id', ondelete='SET NULL'), nullable=True
    )
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now)

    __table_args__ = (
        UniqueConstraint(
            'business_id', 'processing_month', 'employee_id',
            name='uq_absence_exclusions_business_month_employee',
        ),
        Index('ix_absence_exclusions_business_month', 'business_id', 'processing_month'),
    )
