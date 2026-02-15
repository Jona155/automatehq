from datetime import datetime

from sqlalchemy import case, func

from ...extensions import db
from ...models.work_cards import WorkCard, WorkCardDayEntry


class HoursMatrixService:
    def __init__(self, employee_repo, work_card_repo, extraction_repo):
        self.employee_repo = employee_repo
        self.work_card_repo = work_card_repo
        self.extraction_repo = extraction_repo

    @staticmethod
    def sort_employees_for_export(employees):
        return sorted(
            employees,
            key=lambda e: (
                (e.full_name or '').strip().lower(),
                (e.passport_id or '').strip().lower(),
                str(e.id),
            ),
        )

    def load_hours_matrix(self, site_id, business_id, processing_month, approved_only, include_inactive):
        month = datetime.strptime(processing_month, '%Y-%m-%d').date()

        if include_inactive:
            employees = self.employee_repo.get_by_site(site_id, business_id)
        else:
            employees = self.employee_repo.get_active_by_site(site_id, business_id)

        matrix = {}
        status_map = {}

        ranked_cards = db.session.query(
            WorkCard.id.label('work_card_id'),
            WorkCard.employee_id,
            WorkCard.review_status,
            func.row_number().over(
                partition_by=WorkCard.employee_id,
                order_by=[
                    case((WorkCard.review_status == 'APPROVED', 1), else_=2),
                    WorkCard.created_at.desc(),
                ],
            ).label('rank'),
        ).filter(
            WorkCard.business_id == business_id,
            WorkCard.site_id == site_id,
            WorkCard.processing_month == month,
            WorkCard.employee_id.isnot(None),
        )

        if approved_only:
            ranked_cards = ranked_cards.filter(WorkCard.review_status == 'APPROVED')

        ranked_cards = ranked_cards.subquery()

        best_cards = db.session.query(ranked_cards.c.work_card_id).filter(
            ranked_cards.c.rank == 1
        ).subquery()

        day_entries = db.session.query(
            WorkCardDayEntry.work_card_id,
            WorkCardDayEntry.day_of_month,
            WorkCardDayEntry.total_hours,
        ).join(
            WorkCard,
            WorkCard.id == WorkCardDayEntry.work_card_id,
        ).filter(
            WorkCardDayEntry.work_card_id.in_(db.session.query(best_cards.c.work_card_id))
        ).all()

        work_card_to_employee = {}
        cards_query = db.session.query(
            WorkCard.id,
            WorkCard.employee_id,
            WorkCard.review_status,
        ).filter(
            WorkCard.id.in_(db.session.query(best_cards.c.work_card_id))
        ).all()

        for card_id, employee_id, review_status in cards_query:
            employee_id_str = str(employee_id)
            work_card_to_employee[str(card_id)] = employee_id_str
            status_map[employee_id_str] = review_status

        for entry in day_entries:
            employee_id = work_card_to_employee.get(str(entry.work_card_id))
            if employee_id and entry.total_hours is not None:
                matrix.setdefault(employee_id, {})[entry.day_of_month] = float(entry.total_hours)

        employees = self.sort_employees_for_export(employees)
        return employees, matrix, status_map, month

    def get_employee_upload_status(self, site_id, business_id, processing_month):
        month = datetime.strptime(processing_month, '%Y-%m-%d').date()
        employees = self.employee_repo.get_by_site(site_id, business_id)

        result = []
        for employee in employees:
            work_cards = self.work_card_repo.get_by_employee_month(employee.id, month, business_id)
            status = 'NO_UPLOAD'
            work_card_id = None

            if work_cards:
                work_card = work_cards[-1]
                work_card_id = str(work_card.id)
                extraction = self.extraction_repo.get_by_work_card(work_card.id)

                if extraction:
                    if extraction.status == 'FAILED':
                        status = 'FAILED'
                    elif extraction.status in ['PENDING', 'RUNNING']:
                        status = 'PENDING'
                    elif extraction.status == 'DONE':
                        status = 'APPROVED' if work_card.review_status == 'APPROVED' else 'EXTRACTED'
                else:
                    status = 'PENDING'

            result.append({'employee': employee, 'status': status, 'work_card_id': work_card_id})

        return result
