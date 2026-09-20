from typing import Dict, List, Optional
from uuid import UUID

from sqlalchemy import and_, func
from sqlalchemy.orm import selectinload

from .base import BaseRepository
from ..models.contractors import Contractor
from ..models.sites import Employee, Site


class ContractorRepository(BaseRepository[Contractor]):
    def __init__(self):
        super().__init__(Contractor)

    def get_all_for_business(self, business_id: UUID) -> List[Contractor]:
        return (
            self.session.query(Contractor)
            .options(selectinload(Contractor.sites))
            .filter(Contractor.business_id == business_id)
            .order_by(func.lower(Contractor.name), Contractor.id)
            .all()
        )

    def get_active_for_business(self, business_id: UUID) -> List[Contractor]:
        return (
            self.session.query(Contractor)
            .options(selectinload(Contractor.sites))
            .filter(
                Contractor.business_id == business_id,
                Contractor.is_active.is_(True),
            )
            .order_by(func.lower(Contractor.name), Contractor.id)
            .all()
        )

    def get_name_map_for_business(self, business_id: UUID) -> Dict[str, str]:
        """Return contractor names keyed by ID without loading site relationships."""
        return {
            str(contractor_id): name
            for contractor_id, name in (
                self.session.query(Contractor.id, Contractor.name)
                .filter(Contractor.business_id == business_id)
                .all()
            )
        }

    def get_by_name_for_business(
        self,
        name: str,
        business_id: UUID,
    ) -> Optional[Contractor]:
        return (
            self.session.query(Contractor)
            .filter(
                Contractor.business_id == business_id,
                func.lower(Contractor.name) == name.lower(),
            )
            .first()
        )

    def get_active_employee_counts(
        self,
        business_id: UUID,
        contractor_ids: Optional[List[UUID]] = None,
    ) -> Dict[UUID, int]:
        """Count active employees across each contractor's assigned sites."""
        query = (
            self.session.query(
                Contractor.id,
                func.count(Employee.id).label('employee_count'),
            )
            .outerjoin(Site, Site.contractor_id == Contractor.id)
            .outerjoin(
                Employee,
                and_(
                    Employee.site_id == Site.id,
                    Employee.business_id == business_id,
                    Employee.is_active.is_(True),
                ),
            )
            .filter(Contractor.business_id == business_id)
        )
        if contractor_ids is not None:
            if not contractor_ids:
                return {}
            query = query.filter(Contractor.id.in_(contractor_ids))
        return {
            contractor_id: int(employee_count)
            for contractor_id, employee_count in query.group_by(Contractor.id).all()
        }
