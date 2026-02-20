import uuid
from sqlalchemy import Index
from sqlalchemy.dialects.postgresql import UUID
from ..extensions import db
from ..utils import utc_now


class User(db.Model):
    __tablename__ = 'users'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_id = db.Column(UUID(as_uuid=True), db.ForeignKey('businesses.id'), nullable=True)
    full_name = db.Column(db.Text, nullable=False)
    email = db.Column(db.Text, unique=True, nullable=True)
    phone_number = db.Column(db.Text, unique=True, nullable=True)
    role = db.Column(db.Text, nullable=False)  # ADMIN, EMPLOYEE, RESPONSIBLE_EMPLOYEE
    password_hash = db.Column(db.Text, nullable=True)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    __table_args__ = (
        Index('ix_users_business_id', 'business_id'),
    )
