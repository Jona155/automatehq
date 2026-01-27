import uuid
from sqlalchemy.dialects.postgresql import UUID
from ..extensions import db
from ..utils import utc_now

class Business(db.Model):
    __tablename__ = 'businesses'

    id = db.Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    business_name = db.Column(db.Text, unique=True, nullable=False)
    business_code = db.Column(db.Text, nullable=True)
    is_active = db.Column(db.Boolean, default=True)
    created_at = db.Column(db.DateTime(timezone=True), default=utc_now)
    updated_at = db.Column(db.DateTime(timezone=True), default=utc_now, onupdate=utc_now)
