import uuid
from sqlalchemy import Index
from sqlalchemy.dialects.postgresql import UUID, JSONB, BYTEA
from ..extensions import db
from ..utils import utc_now


class WorkCard(db.Model):
    __tablename__ = 'work_cards'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_id = db.Column(UUID(as_uuid=True), db.ForeignKey('businesses.id'), nullable=False)
    site_id = db.Column(UUID(as_uuid=True), db.ForeignKey('sites.id'), nullable=True)
    employee_id = db.Column(UUID(as_uuid=True), db.ForeignKey('employees.id'), nullable=True)
    processing_month = db.Column(db.Date, nullable=False)
    source = db.Column(db.Text, nullable=False)  # ADMIN_SINGLE, ADMIN_BATCH, etc.
    uploaded_by_user_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.id'), nullable=True)
    original_filename = db.Column(db.Text, nullable=True)
    mime_type = db.Column(db.Text, nullable=True)
    file_size_bytes = db.Column(db.Integer, nullable=True)
    sha256_hash = db.Column(db.Text, nullable=True)
    review_status = db.Column(db.Text, nullable=False, default='NEEDS_REVIEW')
    approved_by_user_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.id'), nullable=True)
    approved_at = db.Column(db.DateTime(timezone=True), nullable=True)
    notes = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    # Relationships
    employee = db.relationship('Employee', backref='work_cards', foreign_keys=[employee_id])
    files = db.relationship('WorkCardFile', backref='work_card', uselist=False, cascade="all, delete-orphan")
    extraction = db.relationship('WorkCardExtraction', backref='work_card', uselist=False, cascade="all, delete-orphan")
    day_entries = db.relationship('WorkCardDayEntry', backref='work_card', cascade="all, delete-orphan")

    __table_args__ = (
        Index('ix_work_cards_business_id', 'business_id'),
        Index('ix_work_cards_business_site_month', 'business_id', 'site_id', 'processing_month'),
        Index('ix_work_cards_employee_month', 'employee_id', 'processing_month'),
        Index('ix_work_cards_review_status', 'review_status'),
    )

class WorkCardFile(db.Model):
    __tablename__ = 'work_card_files'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    work_card_id = db.Column(UUID(as_uuid=True), db.ForeignKey('work_cards.id'), unique=True, nullable=False)
    content_type = db.Column(db.Text, nullable=False)
    file_name = db.Column(db.Text, nullable=True)
    file_size_bytes = db.Column(db.Integer, nullable=False)
    image_bytes = db.Column(BYTEA, nullable=False)
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now)

class WorkCardExtraction(db.Model):
    __tablename__ = 'work_card_extraction'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    work_card_id = db.Column(UUID(as_uuid=True), db.ForeignKey('work_cards.id'), unique=True, nullable=False)
    status = db.Column(db.Text, nullable=False, default='PENDING')  # PENDING, RUNNING, DONE, FAILED
    attempts = db.Column(db.Integer, nullable=False, default=0)
    last_error = db.Column(db.Text, nullable=True)

    # Worker lock fields
    locked_at = db.Column(db.DateTime(timezone=True), nullable=True)
    locked_by = db.Column(db.Text, nullable=True)
    started_at = db.Column(db.DateTime(timezone=True), nullable=True)
    finished_at = db.Column(db.DateTime(timezone=True), nullable=True)

    # Extraction outputs
    extracted_employee_name = db.Column(db.Text, nullable=True)
    extracted_passport_id = db.Column(db.Text, nullable=True)
    raw_result_jsonb = db.Column(JSONB, nullable=True)
    normalized_result_jsonb = db.Column(JSONB, nullable=True)

    # Matching outputs
    matched_employee_id = db.Column(UUID(as_uuid=True), db.ForeignKey('employees.id'), nullable=True)
    match_method = db.Column(db.Text, nullable=True)
    match_confidence = db.Column(db.Numeric(4, 3), nullable=True)

    # Metadata
    model_name = db.Column(db.Text, nullable=True)
    model_version = db.Column(db.Text, nullable=True)
    pipeline_version = db.Column(db.Text, nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    __table_args__ = (
        Index('ix_work_card_extraction_status', 'status'),
        Index('ix_work_card_extraction_locked_at', 'locked_at'),
    )

class WorkCardDayEntry(db.Model):
    __tablename__ = 'work_card_day_entries'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    work_card_id = db.Column(UUID(as_uuid=True), db.ForeignKey('work_cards.id'), nullable=False)
    day_of_month = db.Column(db.SmallInteger, nullable=False)
    from_time = db.Column(db.Time, nullable=True)
    to_time = db.Column(db.Time, nullable=True)
    total_hours = db.Column(db.Numeric(5, 2), nullable=True)
    source = db.Column(db.Text, nullable=False, default='EXTRACTED')
    is_valid = db.Column(db.Boolean, nullable=False, default=True)
    validation_errors = db.Column(JSONB, nullable=True)
    updated_by_user_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    __table_args__ = (
        db.UniqueConstraint('work_card_id', 'day_of_month', name='uq_work_card_day_entries_day'),
        db.CheckConstraint('day_of_month >= 1 AND day_of_month <= 31', name='check_day_of_month_range'),
        Index('ix_work_card_day_entries_work_card_id', 'work_card_id'),
    )
