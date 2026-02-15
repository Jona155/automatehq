from sqlalchemy import case, func

from ..models.work_cards import WorkCard, WorkCardDayEntry

_STATUS_PRIORITY = {
    'APPROVED': 4,
    'NEEDS_REVIEW': 3,
    'NEEDS_ASSIGNMENT': 2,
    'REJECTED': 1,
    None: 0,
}


def build_hours_matrix_query(session, business_id, site_id, processing_month, approved_only):
    """Build the optimized matrix query using CTEs and explicit column selection."""
    ranked_cards_cte = session.query(WorkCard).with_entities(
        WorkCard.id.label('work_card_id'),
        WorkCard.employee_id.label('employee_id'),
        WorkCard.review_status.label('review_status'),
        func.row_number().over(
            partition_by=WorkCard.employee_id,
            order_by=[
                case((WorkCard.review_status == 'APPROVED', 1), else_=2),
                WorkCard.created_at.desc(),
                WorkCard.id.desc(),
            ],
        ).label('rank'),
    ).filter(
        WorkCard.business_id == business_id,
        WorkCard.site_id == site_id,
        WorkCard.processing_month == processing_month,
        WorkCard.employee_id.isnot(None),
    )

    if approved_only:
        ranked_cards_cte = ranked_cards_cte.filter(WorkCard.review_status == 'APPROVED')

    ranked_cards_cte = ranked_cards_cte.cte('ranked_cards')

    selected_cards_cte = session.query(ranked_cards_cte).with_entities(
        ranked_cards_cte.c.work_card_id,
        ranked_cards_cte.c.employee_id,
        ranked_cards_cte.c.review_status,
    ).filter(
        ranked_cards_cte.c.rank == 1,
    ).cte('selected_cards')

    return session.query(selected_cards_cte).outerjoin(
        WorkCardDayEntry,
        WorkCardDayEntry.work_card_id == selected_cards_cte.c.work_card_id,
    ).with_entities(
        selected_cards_cte.c.employee_id,
        selected_cards_cte.c.review_status,
        WorkCardDayEntry.day_of_month,
        WorkCardDayEntry.total_hours,
    )


def load_hours_matrix_rows(session, business_id, site_id, processing_month, approved_only):
    return build_hours_matrix_query(
        session=session,
        business_id=business_id,
        site_id=site_id,
        processing_month=processing_month,
        approved_only=approved_only,
    ).all()


def build_matrix_and_status_map(rows):
    matrix = {}
    status_map = {}

    for employee_id, review_status, day_of_month, total_hours in rows:
        employee_id_str = str(employee_id)

        current_status = status_map.get(employee_id_str)
        if _STATUS_PRIORITY.get(review_status, 0) >= _STATUS_PRIORITY.get(current_status, 0):
            status_map[employee_id_str] = review_status

        if day_of_month is None or total_hours is None:
            continue

        employee_days = matrix.setdefault(employee_id_str, {})
        employee_days[day_of_month] = float(total_hours)

    return matrix, status_map
