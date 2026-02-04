import uuid
from sqlalchemy import Index
from sqlalchemy.dialects.postgresql import UUID
from ..extensions import db
from ..utils import utc_now


class UploadAccessRequest(db.Model):
    __tablename__ = 'upload_access_requests'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    token = db.Column(db.String(64), unique=True, nullable=False)
    business_id = db.Column(UUID(as_uuid=True), db.ForeignKey('businesses.id'), nullable=False)
    site_id = db.Column(UUID(as_uuid=True), db.ForeignKey('sites.id'), nullable=False)
    employee_id = db.Column(UUID(as_uuid=True), db.ForeignKey('employees.id'), nullable=False)
    processing_month = db.Column(db.Date, nullable=False)
    created_by_user_id = db.Column(UUID(as_uuid=True), db.ForeignKey('users.id'), nullable=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now)
    expires_at = db.Column(db.DateTime(timezone=True), nullable=True)
    last_accessed_at = db.Column(db.DateTime(timezone=True), nullable=True)
    is_active = db.Column(db.Boolean, default=True)

    __table_args__ = (
        Index('ix_upload_access_requests_token', 'token'),
        Index('ix_upload_access_requests_site', 'site_id'),
    )
