from datetime import date
from typing import Dict
from uuid import UUID

from sqlalchemy import and_, case, func

from ...extensions import db
from ...models.sites import Employee
from ...models.work_cards import WorkCard, WorkCardExtraction


def get_latest_work_card_with_extraction_by_employee(
    business_id: UUID,
    site_id: UUID,
    processing_month: date,
):
    """Return one row per employee with latest relevant work-card and extraction status."""
    ranked_cards = db.session.query(
        WorkCard.id.label('work_card_id'),
        WorkCard.employee_id.label('employee_id'),
        WorkCard.review_status.label('review_status'),
        func.row_number().over(
            partition_by=WorkCard.employee_id,
            order_by=[
                case(
                    (WorkCard.review_status == 'APPROVED', 1),
                    else_=2,
                ),
                WorkCard.created_at.desc(),
            ],
        ).label('row_number'),
    ).filter(
        WorkCard.business_id == business_id,
        WorkCard.site_id == site_id,
        WorkCard.processing_month == processing_month,
        WorkCard.employee_id.isnot(None),
    ).subquery()

    return db.session.query(
        Employee,
        ranked_cards.c.work_card_id,
        ranked_cards.c.review_status,
        WorkCardExtraction.status.label('extraction_status'),
    ).outerjoin(
        ranked_cards,
        and_(
            ranked_cards.c.employee_id == Employee.id,
            ranked_cards.c.row_number == 1,
        ),
    ).outerjoin(
        WorkCardExtraction,
        WorkCardExtraction.work_card_id == ranked_cards.c.work_card_id,
    ).filter(
        Employee.site_id == site_id,
        Employee.business_id == business_id,
    ).all()


def build_employee_upload_status_map(employee_rows) -> Dict[str, Dict[str, str]]:
    """Build per-employee upload status map from batched query rows."""
    status_by_employee: Dict[str, Dict[str, str]] = {}

    for employee, work_card_id, review_status, extraction_status in employee_rows:
        status = 'NO_UPLOAD'
        if work_card_id:
            if extraction_status is None:
                status = 'PENDING'
            elif extraction_status == 'FAILED':
                status = 'FAILED'
            elif extraction_status in {'PENDING', 'RUNNING'}:
                status = 'PENDING'
            elif extraction_status == 'DONE':
                status = 'APPROVED' if review_status == 'APPROVED' else 'EXTRACTED'

        status_by_employee[str(employee.id)] = {
            'status': status,
            'work_card_id': str(work_card_id) if work_card_id else None,
        }

    return status_by_employee
