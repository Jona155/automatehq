from datetime import datetime, timezone
from typing import Optional
from uuid import UUID
from sqlalchemy import or_
from .base import BaseRepository
from ..models.upload_access import UploadAccessRequest
from ..models.sites import Employee
from ..extensions import db


class UploadAccessRequestRepository(BaseRepository[UploadAccessRequest]):
    def __init__(self):
        super().__init__(UploadAccessRequest)

    def token_exists(self, token: str) -> bool:
        return db.session.query(
            db.session.query(UploadAccessRequest).filter_by(token=token).exists()
        ).scalar()

    def get_active_by_token(self, token: str) -> Optional[UploadAccessRequest]:
        now = datetime.now(timezone.utc)
        return db.session.query(UploadAccessRequest).filter(
            UploadAccessRequest.token == token,
            UploadAccessRequest.is_active.is_(True),
            or_(UploadAccessRequest.expires_at.is_(None), UploadAccessRequest.expires_at > now),
        ).first()

    def list_active_for_site(self, site_id, business_id):
        now = datetime.now(timezone.utc)
        return db.session.query(UploadAccessRequest).filter(
            UploadAccessRequest.site_id == site_id,
            UploadAccessRequest.business_id == business_id,
            UploadAccessRequest.is_active.is_(True),
            or_(UploadAccessRequest.expires_at.is_(None), UploadAccessRequest.expires_at > now),
        ).order_by(UploadAccessRequest.created_at.desc()).all()


    def list_active_for_site_with_employee(self, site_id: UUID, business_id: UUID):
        now = datetime.now(timezone.utc)
        return db.session.query(UploadAccessRequest, Employee.full_name).outerjoin(
            Employee,
            (UploadAccessRequest.employee_id == Employee.id) &
            (Employee.business_id == business_id)
        ).filter(
            UploadAccessRequest.site_id == site_id,
            UploadAccessRequest.business_id == business_id,
            UploadAccessRequest.is_active.is_(True),
            or_(UploadAccessRequest.expires_at.is_(None), UploadAccessRequest.expires_at > now),
        ).order_by(UploadAccessRequest.created_at.desc()).all()

    def revoke(self, request_id):
        return self.update(request_id, is_active=False)
