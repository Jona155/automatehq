import uuid
from sqlalchemy.dialects.postgresql import UUID
from ..extensions import db
from ..utils import utc_now


class Business(db.Model):
    __tablename__ = 'businesses'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = db.Column(db.Text, nullable=False)
    code = db.Column(db.Text, unique=True, nullable=False)  # URL-friendly slug
    is_active = db.Column(db.Boolean, default=True)
    default_month_cutoff_day = db.Column(
        db.SmallInteger,
        nullable=True,
        info={'check': 'default_month_cutoff_day >= 1 AND default_month_cutoff_day <= 28'}
    )
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    # Relationships
    users = db.relationship('User', backref='business', lazy='dynamic')
    sites = db.relationship('Site', backref='business', lazy='dynamic')
    employees = db.relationship('Employee', backref='business', lazy='dynamic')
    work_cards = db.relationship('WorkCard', backref='business', lazy='dynamic')
    export_runs = db.relationship('ExportRun', backref='business', lazy='dynamic')
    audit_events = db.relationship('AuditEvent', backref='business', lazy='dynamic')
