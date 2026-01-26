import uuid
from sqlalchemy import Index
from sqlalchemy.dialects.postgresql import UUID, JSONB
from ..extensions import db
from ..utils import utc_now

class ExportRun(db.Model):
    __tablename__ = 'export_runs'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    processing_month = db.Column(db.Date, nullable=False)
    site_id = db.Column(UUID(as_uuid=True), db.ForeignKey('sites.id'), nullable=True)
    exported_by_user_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.id'), nullable=True)
    export_filters = db.Column(JSONB, nullable=True)
    row_count = db.Column(db.Integer, nullable=True)
    generated_file_name = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now)

    __table_args__ = (
        Index('ix_export_runs_month_site', 'processing_month', 'site_id'),
    )

class AuditEvent(db.Model):
    __tablename__ = 'audit_events'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    actor_user_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.id'), nullable=True)
    event_type = db.Column(db.Text, nullable=False)
    entity_type = db.Column(db.Text, nullable=False)
    entity_id = db.Column(UUID(as_uuid=True), nullable=False)
    site_id = db.Column(UUID(as_uuid=True), db.ForeignKey('sites.id'), nullable=True)
    employee_id = db.Column(UUID(as_uuid=True), db.ForeignKey('employees.id'), nullable=True)
    work_card_id = db.Column(UUID(as_uuid=True), db.ForeignKey('work_cards.id'), nullable=True)
    event_metadata = db.Column('metadata', JSONB, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now)

    __table_args__ = (
        Index('ix_audit_events_entity', 'entity_type', 'entity_id'),
        Index('ix_audit_events_site_time', 'site_id', 'created_at'),
    )
