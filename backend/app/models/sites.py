import uuid
from sqlalchemy import Index
from sqlalchemy.dialects.postgresql import UUID
from ..extensions import db
from ..utils import utc_now


class Site(db.Model):
    __tablename__ = 'sites'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_id = db.Column(UUID(as_uuid=True), db.ForeignKey('businesses.id'), nullable=False)
    site_name = db.Column(db.Text, nullable=False)
    site_code = db.Column(db.Text, nullable=True)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    __table_args__ = (
        Index('ix_sites_business_id', 'business_id'),
        db.UniqueConstraint('business_id', 'site_name', name='uq_sites_business_name'),
    )


class Employee(db.Model):
    __tablename__ = 'employees'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_id = db.Column(UUID(as_uuid=True), db.ForeignKey('businesses.id'), nullable=False)
    site_id = db.Column(UUID(as_uuid=True), db.ForeignKey('sites.id'), nullable=False)
    full_name = db.Column(db.Text, nullable=False)
    passport_id = db.Column(db.Text, nullable=True)
    phone_number = db.Column(db.Text, nullable=False)
    external_employee_id = db.Column(db.Text, nullable=True)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    __table_args__ = (
        Index('ix_employees_business_id', 'business_id'),
        Index('ix_employees_site_id', 'site_id'),
        Index('ix_employees_business_passport', 'business_id', 'passport_id', unique=True, postgresql_where='passport_id IS NOT NULL'),
    )
