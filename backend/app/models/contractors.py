import uuid

from sqlalchemy import Index, func
from sqlalchemy.dialects.postgresql import UUID

from ..extensions import db
from ..utils import utc_now


class Contractor(db.Model):
    __tablename__ = 'contractors'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_id = db.Column(
        UUID(as_uuid=True),
        db.ForeignKey('businesses.id'),
        nullable=False,
    )
    name = db.Column(db.Text, nullable=False)
    email = db.Column(db.Text, nullable=True)
    phone_number = db.Column(db.Text, nullable=True)
    address = db.Column(db.Text, nullable=True)
    is_active = db.Column(db.Boolean, nullable=False, default=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now)

    sites = db.relationship('Site', back_populates='contractor')

    __table_args__ = (
        Index('ix_contractors_business_id', 'business_id'),
        Index(
            'uq_contractors_business_lower_name',
            'business_id',
            func.lower(name),
            unique=True,
        ),
    )
