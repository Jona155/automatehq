"""Tests for moving a work card between processing months.

The pure planner tests need nothing. The DB tests require a reachable local
Postgres (same as the other DB-backed tests).
"""
import unittest
import uuid
from datetime import date, datetime, time, timezone
from types import SimpleNamespace

from dotenv import load_dotenv

load_dotenv()

from backend.app import create_app, db
from backend.app.models.audit import AuditEvent
from backend.app.models.business import Business
from backend.app.models.sites import Site, Employee
from backend.app.models.work_cards import WorkCard, WorkCardDayEntry, WorkCardExtraction
from backend.app.services.work_card_month_move import (
    MoveMonthError,
    move_work_card_month,
    parse_month,
    plan_day_entries,
)

OCT = date(2026, 10, 1)
NOV = date(2026, 11, 1)


def _utc(y, m, d, hh=12):
    return datetime(y, m, d, hh, 0, tzinfo=timezone.utc)


def _x(day, start='07:00', end='16:00', total=9.0):
    """An extracted row as the worker stores it in normalized_result_jsonb."""
    return {'day': day, 'start_time': start, 'end_time': end, 'total_hours': total}


def _prev(start=time(7, 0), end=time(16, 0), total=9.0):
    return SimpleNamespace(from_time=start, to_time=end, total_hours=total)


class ParseMonthTests(unittest.TestCase):
    def test_accepts_both_formats(self):
        self.assertEqual(parse_month('2026-11'), NOV)
        self.assertEqual(parse_month('2026-11-18'), NOV)

    def test_rejects_garbage(self):
        for bad in (None, '', '2026', '2026-13', 'nov', 202611):
            self.assertIsNone(parse_month(bad))


class PlanDayEntriesTests(unittest.TestCase):
    def test_writes_all_days_when_nothing_blocks(self):
        plan = plan_day_entries([_x(1), _x(2)], [], {}, 0)
        self.assertEqual([e['day'] for e in plan['create']], [1, 2])

    def test_skips_days_the_card_already_holds(self):
        plan = plan_day_entries([_x(1), _x(2)], [2], {}, 0)
        self.assertEqual([e['day'] for e in plan['create']], [1])

    def test_skips_days_inside_approved_range(self):
        plan = plan_day_entries([_x(3), _x(4), _x(5)], [], {}, 4)
        self.assertEqual([e['day'] for e in plan['create']], [5])
        self.assertEqual(plan['skipped_protected'], 2)

    def test_skips_day_identical_to_previous_card(self):
        plan = plan_day_entries([_x(1), _x(2, end='18:00', total=11.0)], [], {1: _prev(), 2: _prev()}, 0)
        self.assertEqual([e['day'] for e in plan['create']], [2])
        self.assertEqual(plan['skipped_duplicate'], 1)

    def test_ignores_invalid_and_repeated_days(self):
        plan = plan_day_entries([_x(0), _x(32), {'day': None}, _x(7), _x(7)], [], {}, 0)
        self.assertEqual([e['day'] for e in plan['create']], [7])


class MoveMonthDBTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.ctx = self.app.app_context()
        self.ctx.push()
        self.business = Business(name='Move Month Biz', code=f'move-{uuid.uuid4().hex[:12]}')
        db.session.add(self.business)
        db.session.flush()
        self.site = Site(business_id=self.business.id, site_name=f'Site {uuid.uuid4().hex[:8]}')
        db.session.add(self.site)
        db.session.flush()
        self.emp = Employee(
            business_id=self.business.id,
            site_id=self.site.id,
            full_name=f'Emp {uuid.uuid4().hex[:8]}',
            passport_id=f'P{uuid.uuid4().hex[:10]}',
            is_active=True,
        )
        db.session.add(self.emp)
        db.session.commit()

    def tearDown(self):
        try:
            db.session.rollback()
            card_ids = [c.id for c in WorkCard.query.filter_by(business_id=self.business.id).all()]
            AuditEvent.query.filter_by(business_id=self.business.id).delete()
            if card_ids:
                WorkCardDayEntry.query.filter(WorkCardDayEntry.work_card_id.in_(card_ids)).delete(synchronize_session=False)
                WorkCardExtraction.query.filter(WorkCardExtraction.work_card_id.in_(card_ids)).delete(synchronize_session=False)
            WorkCard.query.filter_by(business_id=self.business.id).delete()
            Employee.query.filter_by(business_id=self.business.id).delete()
            Site.query.filter_by(business_id=self.business.id).delete()
            db.session.delete(db.session.get(Business, self.business.id))
            db.session.commit()
        except Exception:
            db.session.rollback()
        self.ctx.pop()

    # ---- helpers ----
    def _card(self, month, created_at, *, extracted=None, stored_days=None, status='NEEDS_REVIEW',
              sha=None, approved_through_day=None, completes_month=False, employee=True):
        """Create a card. `extracted` is what the AI read (stored JSON);
        `stored_days` is the subset the worker actually saved as day entries
        (defaults to all of them)."""
        card = WorkCard(
            business_id=self.business.id,
            site_id=self.site.id if employee else None,
            employee_id=self.emp.id if employee else None,
            processing_month=month,
            source='WHATSAPP',
            review_status=status,
            sha256_hash=sha,
            approved_through_day=approved_through_day,
            completes_month=completes_month,
            created_at=created_at,
        )
        db.session.add(card)
        db.session.flush()
        if extracted is not None:
            db.session.add(WorkCardExtraction(
                work_card_id=card.id, status='DONE',
                normalized_result_jsonb={'entries': extracted},
            ))
            keep = set(stored_days) if stored_days is not None else {e['day'] for e in extracted}
            for e in extracted:
                if e['day'] in keep:
                    self._entry(card, e['day'], e['start_time'], e['end_time'], e['total_hours'])
        db.session.flush()
        return card

    def _entry(self, card, day, start='07:00', end='16:00', total=9.0, source='EXTRACTED'):
        h1, m1 = map(int, start.split(':'))
        h2, m2 = map(int, end.split(':'))
        db.session.add(WorkCardDayEntry(
            work_card_id=card.id, day_of_month=day,
            from_time=time(h1, m1), to_time=time(h2, m2), total_hours=total,
            source=source, is_valid=True,
        ))

    def _days(self, card):
        rows = WorkCardDayEntry.query.filter_by(work_card_id=card.id).all()
        return {r.day_of_month: r for r in rows}

    # ---- the core scenario ----
    def test_misrouted_card_recovers_days_dropped_as_duplicates(self):
        # October card: full shifts on days 1-8 (and beyond).
        self._card(OCT, _utc(2026, 11, 3), extracted=[_x(d) for d in range(1, 21)])
        # Nov 1-8 card landed in October. Days 1-7 matched October's shifts and
        # were dropped by the worker; only day 8 (different hours) was saved.
        nov_rows = [_x(d) for d in range(1, 8)] + [_x(8, end='13:00', total=6.0)]
        moved = self._card(OCT, _utc(2026, 11, 8), extracted=nov_rows, stored_days=[8])
        db.session.commit()
        self.assertEqual(set(self._days(moved)), {8})

        summary = move_work_card_month(moved, NOV)

        self.assertEqual(moved.processing_month, NOV)
        self.assertEqual(set(self._days(moved)), set(range(1, 9)))
        self.assertEqual(summary['days_written'], 8)

    def test_later_source_card_gets_back_days_it_dropped(self):
        moved = self._card(OCT, _utc(2026, 11, 2), extracted=[_x(d) for d in range(1, 6)])
        # A real October card arrived later; days 1-5 repeated the misrouted
        # card's values so the worker dropped them.
        later = self._card(
            OCT, _utc(2026, 11, 5),
            extracted=[_x(d) for d in range(1, 11)], stored_days=range(6, 11),
        )
        db.session.commit()

        summary = move_work_card_month(moved, NOV)

        self.assertEqual(set(self._days(later)), set(range(1, 11)))
        self.assertEqual(summary['source_siblings_rebuilt'], 1)
        self.assertEqual(summary['source_days_restored'], 5)

    def test_manual_days_survive_the_move(self):
        moved = self._card(OCT, _utc(2026, 11, 8), extracted=[_x(1), _x(2)])
        # The reviewer corrected day 2 by hand before moving.
        WorkCardDayEntry.query.filter_by(work_card_id=moved.id, day_of_month=2).delete()
        self._entry(moved, 2, '08:00', '12:00', 4.0, source='MANUAL')
        db.session.commit()

        move_work_card_month(moved, NOV)

        days = self._days(moved)
        self.assertEqual(days[2].source, 'MANUAL')
        self.assertEqual(float(days[2].total_hours), 4.0)
        self.assertEqual(days[1].source, 'EXTRACTED')

    def test_target_month_approved_days_are_not_overwritten(self):
        self._card(NOV, _utc(2026, 11, 6), extracted=[_x(d) for d in range(1, 5)],
                   status='APPROVED', approved_through_day=4)
        moved = self._card(OCT, _utc(2026, 11, 8),
                           extracted=[_x(d, end='18:00', total=11.0) for d in range(1, 9)])
        db.session.commit()

        summary = move_work_card_month(moved, NOV)

        self.assertEqual(set(self._days(moved)), {5, 6, 7, 8})
        self.assertEqual(summary['days_skipped_protected'], 4)

    def test_month_scoped_flags_reset_and_audit_written(self):
        moved = self._card(OCT, _utc(2026, 11, 8), extracted=[_x(1)], completes_month=True)
        db.session.commit()

        move_work_card_month(moved, NOV)

        self.assertFalse(moved.completes_month)
        event = AuditEvent.query.filter_by(work_card_id=moved.id, event_type='MOVE_MONTH').one()
        self.assertEqual(event.event_metadata['from_month'], '2026-10-01')
        self.assertEqual(event.event_metadata['to_month'], '2026-11-01')

    def test_unassigned_card_without_extraction_just_moves(self):
        moved = self._card(OCT, _utc(2026, 11, 8), employee=False)
        db.session.commit()
        summary = move_work_card_month(moved, NOV)
        self.assertEqual(moved.processing_month, NOV)
        self.assertEqual(summary['days_written'], 0)

    # ---- guards ----
    def test_approved_card_is_blocked(self):
        card = self._card(OCT, _utc(2026, 11, 8), extracted=[_x(1)], status='APPROVED')
        db.session.commit()
        with self.assertRaises(MoveMonthError) as ctx:
            move_work_card_month(card, NOV)
        self.assertEqual(ctx.exception.code, 'CARD_APPROVED')
        self.assertEqual(card.processing_month, OCT)

    def test_same_image_in_target_month_is_blocked(self):
        self._card(NOV, _utc(2026, 11, 7), sha='abc123')
        card = self._card(OCT, _utc(2026, 11, 8), sha='abc123')
        db.session.commit()
        with self.assertRaises(MoveMonthError) as ctx:
            move_work_card_month(card, NOV)
        self.assertEqual(ctx.exception.code, 'DUPLICATE_IN_TARGET')

    def test_same_month_is_rejected(self):
        card = self._card(OCT, _utc(2026, 11, 8))
        db.session.commit()
        with self.assertRaises(MoveMonthError) as ctx:
            move_work_card_month(card, OCT)
        self.assertEqual(ctx.exception.code, 'SAME_MONTH')

    def test_card_being_extracted_is_blocked(self):
        card = self._card(OCT, _utc(2026, 11, 8))
        db.session.add(WorkCardExtraction(work_card_id=card.id, status='RUNNING'))
        db.session.commit()
        with self.assertRaises(MoveMonthError) as ctx:
            move_work_card_month(card, NOV)
        self.assertEqual(ctx.exception.code, 'CARD_PROCESSING')


if __name__ == '__main__':
    unittest.main()
