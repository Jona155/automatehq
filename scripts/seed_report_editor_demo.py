"""Seed demo data for trying out the report editor (Preview & edit reports).

Adds 2 demo sites (site_code RPTDEMO-*) and 12 demo employees (passport
RPTD*) to the existing business that admin@example.com logs into (code
`automatehq`), with work cards for Oct 2026 (a full month) and Nov 2026 (in
progress). A few saved edits, a note and one "source changed" conflict are
created on the October report so those states are visible straight away.
Three employees have days worked at the other demo site ("עבד באתר אחר").
Nothing that isn't tagged as demo data is touched.

Usage (from repo root, env loaded):
    set -a && . ./.env && set +a
    PYTHONPATH=. venv/bin/python scripts/seed_report_editor_demo.py            # (re)create
    PYTHONPATH=. venv/bin/python scripts/seed_report_editor_demo.py --cleanup  # remove it

Idempotent: previously seeded demo rows are removed and rebuilt.
"""
import sys
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal

from backend.app import create_app, db
from backend.app.models import Business, Employee, Site, User, WorkCard, WorkCardDayEntry
from backend.app.models.audit import AuditEvent
from backend.app.models.report_adjustments import ReportAdjustment, ReportNote, ReportRevision
from backend.app.services.sites import report_adjustments_service as adjustments

TARGET_CODE = 'automatehq'
ADMIN_EMAIL = 'admin@example.com'
SITE_TAG = 'RPTDEMO'
PASSPORT_TAG = 'RPTD'

OCT = date(2026, 10, 1)
NOV = date(2026, 11, 1)
NOV_THROUGH = 22  # November is still in progress


def days_in(month):
    nxt = date(month.year + (month.month == 12), month.month % 12 + 1, 1)
    return (nxt - timedelta(days=1)).day


def weekday(month, d):
    return date(month.year, month.month, d).weekday()  # Mon=0 .. Sat=5


def workdays(month, upto=None):
    return [d for d in range(1, (upto or days_in(month)) + 1) if weekday(month, d) != 5]


class Seeder:
    def __init__(self, business, admin):
        self.business = business
        self.admin = admin
        self.seq = 0

    def employee(self, name, site, active=True):
        self.seq += 1
        emp = Employee(
            business_id=self.business.id, site_id=site.id, full_name=name,
            passport_id=f'{PASSPORT_TAG}{self.seq:04d}', external_employee_id=str(7000 + self.seq),
            is_active=active, status='ACTIVE',
        )
        db.session.add(emp)
        db.session.flush()
        return emp

    def card(self, emp, month, days, status='APPROVED', site=None, hours=None,
             sick=(), vacation=(), holiday=(), visa=(), missing=(), comments=None, elsewhere=None):
        """Card with worked hours on `days`; `hours` maps day -> hours override.

        `elsewhere` maps day -> Site for days worked at another site (the hours
        are attributed there, and this site's report marks the day)."""
        hours = hours or {}
        elsewhere = elsewhere or {}
        comments = comments or {}
        card = WorkCard(
            business_id=self.business.id, site_id=site.id if site else emp.site_id,
            employee_id=emp.id, processing_month=month, source='MANUAL', review_status=status,
            created_at=datetime(month.year, month.month, 25, 10, tzinfo=timezone.utc),
        )
        if status == 'APPROVED':
            card.approved_by_user_id = self.admin.id
            card.approved_at = card.created_at + timedelta(days=1)
            card.approved_through_day = max(days) if days else None
        db.session.add(card)
        db.session.flush()

        statuses = {}
        for name, ds in (('SICK', sick), ('VACATION', vacation), ('HOLIDAY', holiday), ('INTERNATIONAL_VISA', visa)):
            for d in ds:
                statuses[d] = name
        src = 'MANUAL' if status == 'APPROVED' else 'EXTRACTED'
        for d in days:
            if d in missing:
                continue
            if d in statuses:
                db.session.add(WorkCardDayEntry(work_card_id=card.id, day_of_month=d, day_status=statuses[d],
                                                source=src, comment=comments.get(d)))
                continue
            short = weekday(month, d) == 4  # Friday
            total = Decimal(str(hours.get(d, 5 if short else 9)))
            db.session.add(WorkCardDayEntry(
                work_card_id=card.id, day_of_month=d, source=src,
                from_time=time(7, 0), to_time=time(12, 0) if short else time(16, 0),
                total_hours=total, comment=comments.get(d),
                attributed_site_id=elsewhere[d].id if d in elsewhere else None,
            ))
        db.session.flush()
        return card


def cleanup(biz):
    emp_ids = [e.id for e in Employee.query.filter(
        Employee.business_id == biz.id, Employee.passport_id.like(f'{PASSPORT_TAG}%'))]
    site_ids = [x.id for x in Site.query.filter(
        Site.business_id == biz.id, Site.site_code.like(f'{SITE_TAG}%'))]
    if site_ids:
        for model in (ReportAdjustment, ReportNote, ReportRevision):
            model.query.filter(model.site_id.in_(site_ids)).delete(synchronize_session=False)
        AuditEvent.query.filter(AuditEvent.entity_type == 'SITE_REPORT',
                                AuditEvent.entity_id.in_(site_ids)).delete(synchronize_session=False)
    if emp_ids:
        card_ids = [c.id for c in WorkCard.query.filter(WorkCard.employee_id.in_(emp_ids))]
        if card_ids:
            WorkCardDayEntry.query.filter(WorkCardDayEntry.work_card_id.in_(card_ids)).delete(synchronize_session=False)
            WorkCard.query.filter(WorkCard.id.in_(card_ids)).delete(synchronize_session=False)
        Employee.query.filter(Employee.id.in_(emp_ids)).delete(synchronize_session=False)
    if site_ids:
        Site.query.filter(Site.id.in_(site_ids)).delete(synchronize_session=False)
    db.session.commit()
    return len(emp_ids), len(site_ids)


def build():
    biz = Business.query.filter_by(code=TARGET_CODE).first()
    admin = User.query.filter_by(email=ADMIN_EMAIL, business_id=biz.id).first() if biz else None
    if not biz or not admin:
        sys.exit(f"Business '{TARGET_CODE}' with admin {ADMIN_EMAIL} not found")

    removed = cleanup(biz)
    if '--cleanup' in sys.argv:
        print(f'Removed {removed[0]} demo employees and {removed[1]} demo sites')
        return

    tower = Site(business_id=biz.id, site_name='הדגמה דוחות – מגדל הים', site_code=f'{SITE_TAG}-A',
                 is_active=True, hourly_tariff=Decimal('62'))
    park = Site(business_id=biz.id, site_name='הדגמה דוחות – פארק המדע', site_code=f'{SITE_TAG}-B',
                is_active=True, hourly_tariff=Decimal('58.5'))
    db.session.add_all([tower, park])
    db.session.flush()

    s = Seeder(biz, admin)
    oct_all = workdays(OCT)
    nov_all = workdays(NOV, NOV_THROUGH)
    # Sukkot / Simchat Torah fall on 3 Oct (Saturday); keep one marked holiday for show.
    people = {}

    # ---- Site A: 8 employees -------------------------------------------
    e = people['full'] = s.employee('אנדריי פופסקו', tower)
    s.card(e, OCT, oct_all)
    s.card(e, NOV, nov_all)

    e = people['overtime'] = s.employee('וסילה יונסקו', tower)
    # Lent to the other demo site for three days at the end of the month.
    s.card(e, OCT, oct_all, hours={5: 11, 6: 11.5, 12: 10, 19: 12, 27: 10.5},
           comments={19: 'יציקה – נשארו עד מאוחר'}, elsewhere={26: park, 28: park, 29: park})
    s.card(e, NOV, nov_all, hours={3: 10, 10: 11})

    e = people['sick'] = s.employee('לי וויי', tower)
    s.card(e, OCT, oct_all, sick=[13, 14, 15], comments={13: 'אישור מחלה התקבל'})
    s.card(e, NOV, nov_all, sick=[9])

    e = people['vacation'] = s.employee('ג׳אנג מין', tower)
    s.card(e, OCT, oct_all, vacation=[18, 19, 20, 21, 22], hours={7: 8.5, 8: 8.5})
    s.card(e, NOV, nov_all)

    e = people['visa'] = s.employee('סומצ׳אי וונג', tower)
    s.card(e, OCT, oct_all, visa=[25, 26, 27, 28], holiday=[2])
    s.card(e, NOV, nov_all, elsewhere={16: park, 17: park})

    e = people['pending'] = s.employee('דמיטרי מורוזוב', tower)
    s.card(e, OCT, oct_all, status='NEEDS_REVIEW', hours={11: 7, 20: 6.5}, missing=[29, 30])
    s.card(e, NOV, nov_all, status='NEEDS_REVIEW')

    e = people['gaps'] = s.employee('אולג קובלנקו', tower)
    s.card(e, OCT, oct_all, missing=[6, 7, 21], hours={14: 4})
    s.card(e, NOV, [d for d in nov_all if d <= 15])

    people['nocard'] = s.employee('ראג׳ קומאר', tower)  # no card at all

    inactive = s.employee('פיוטר נובאק (לא פעיל)', tower, active=False)
    s.card(inactive, OCT, [d for d in oct_all if d <= 14])  # appears in Salary only

    # ---- Site B: 4 employees, one of them also works at site A ---------
    e = s.employee('מריוס דומיטרו', park)
    s.card(e, OCT, oct_all, hours={1: 10, 15: 10})
    s.card(e, NOV, nov_all)

    e = s.employee('צ׳ן לונג', park)
    s.card(e, OCT, oct_all, sick=[26, 27], vacation=[8, 9])
    s.card(e, NOV, nov_all, hours={12: 11})

    shared = s.employee('איוון פטרנקו', park)
    s.card(shared, OCT, oct_all, elsewhere={d: tower for d in oct_all if 18 <= d <= 23})  # a week lent to site A
    s.card(shared, NOV, nov_all)

    e = s.employee('נגוין ואן', park)
    s.card(e, OCT, oct_all, status='NEEDS_REVIEW', missing=[12, 13])
    s.card(e, NOV, [d for d in nov_all if d <= 15], status='NEEDS_REVIEW')

    db.session.commit()

    # ---- A few saved edits on site A / October --------------------------
    seeded_edits = []
    if adjustments.is_enabled():
        rev = adjustments.get_revision(tower.id, OCT)
        gaps, sick, full = people['gaps'], people['sick'], people['full']
        rev = adjustments.save_report_changes(
            business_id=biz.id, site=tower, month=OCT, report_type=adjustments.REPORT_SUMMARY,
            base_revision=rev, user_id=admin.id,
            cells=[
                {'employee_id': str(gaps.id), 'day': 6, 'value': '9'},      # filled a missing day
                {'employee_id': str(gaps.id), 'day': 14, 'value': '8.5'},   # corrected hours
                {'employee_id': str(sick.id), 'day': 16, 'value': 'מחלה'},  # extended the sick leave
                {'employee_id': str(full.id), 'day': 8, 'value': '7'},      # will become a conflict
            ],
            notes=[
                {'employee_id': str(gaps.id), 'day': 6, 'text': 'אושר טלפונית מול מנהל העבודה'},
                {'employee_id': str(sick.id), 'day': 16, 'text': 'אישור מחלה הוארך ביום נוסף'},
            ],
        )
        # The attendance value changes after the edit -> the cell is flagged for review.
        card = WorkCard.query.filter_by(employee_id=full.id, processing_month=OCT).first()
        entry = WorkCardDayEntry.query.filter_by(work_card_id=card.id, day_of_month=8).first()
        entry.total_hours = Decimal('10')
        db.session.commit()
        seeded_edits = [
            (gaps.full_name, 6, 'edited: empty -> 9, with a note'),
            (gaps.full_name, 14, 'edited: 4 -> 8.5'),
            (sick.full_name, 16, 'edited: 5 -> sick, with a note'),
            (full.full_name, 8, 'edited to 7, then attendance changed 9 -> 10 (flagged)'),
        ]

    base = f'http://localhost:5173/{TARGET_CODE}'
    print(f"\nDemo data added to business '{biz.name}' (code: {TARGET_CODE}).")
    print(f"  Login:   {ADMIN_EMAIL} (your existing login)")
    print(f"  Site A:  {base}/sites/{tower.id}/reports?type=summary&month=2026-10")
    print(f"  Site B:  {base}/sites/{park.id}/reports?type=summary&month=2026-10")
    print('  Months:  2026-10 (full), 2026-11 (through the 22nd)')
    if seeded_edits:
        print('  Saved edits on site A, October:')
        for name, day, what in seeded_edits:
            print(f'    {name:<16} day {day:<3} {what}')
    else:
        print('  REPORT_EDITOR_ENABLED is off - no saved edits were created.')


if __name__ == '__main__':
    with create_app().app_context():
        build()
