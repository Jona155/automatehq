"""Seed demo data for the "worked at another site" (עבד באתר אחר) report marker.

Adds three demo sites (site codes OSDEMO-X/Y/Z) and four employees to the
business with code `automatehq`, all for November 2026. Every card is approved
and its days are split across sites through per-day `attributed_site_id`,
exactly how the review UI records multi-site work. No image, no AI call.

Scenarios:
  A  home X: Nov 1-8 at X, Nov 9-15 at Y                (the ticket's example)
  B  home X: Nov 1-5 at X, 6-10 at Y, 11-15 at Z        (three sites)
  C  home Y: Nov 1-10 at Y, Nov 11 VACATION tagged to X (status day: Y gets no marker)
  D  home X: Nov 1-12 at X only                         (control: no marker)

Usage (from repo root):
    set -a && . ./.env && set +a
    PYTHONPATH=. venv/bin/python scripts/seed_other_site_demo.py            # (re)create
    PYTHONPATH=. venv/bin/python scripts/seed_other_site_demo.py --cleanup  # remove it

Idempotent: re-running removes the previous demo rows first.
"""
import sys
from datetime import date, datetime, time, timezone

from backend.app import create_app, db
from backend.app.models import Business, Employee, Site, User, WorkCard, WorkCardDayEntry
from backend.app.models.audit import AuditEvent
from backend.app.models.work_cards import WorkCardExtraction, WorkCardFile

TARGET_CODE = 'automatehq'
ADMIN_EMAIL = 'admin@example.com'
SITE_PREFIX = 'OSDEMO-'
PASSPORT_TAG = 'OSDEMO'
MONTH = date(2026, 11, 1)
APPROVED_AT = datetime(2026, 11, 18, 10, tzinfo=timezone.utc)


def is_sat(d):
    return date(MONTH.year, MONTH.month, d).weekday() == 5


def cleanup(biz):
    site_ids = [s.id for s in Site.query.filter(
        Site.business_id == biz.id, Site.site_code.like(f'{SITE_PREFIX}%'))]
    emp_ids = [e.id for e in Employee.query.filter(
        Employee.business_id == biz.id, Employee.passport_id.like(f'{PASSPORT_TAG}%'))]
    card_ids = [c.id for c in WorkCard.query.filter(
        WorkCard.business_id == biz.id, WorkCard.employee_id.in_(emp_ids))] if emp_ids else []
    if card_ids:
        AuditEvent.query.filter(AuditEvent.work_card_id.in_(card_ids)).delete(synchronize_session=False)
        WorkCardDayEntry.query.filter(WorkCardDayEntry.work_card_id.in_(card_ids)).delete(synchronize_session=False)
        WorkCardExtraction.query.filter(WorkCardExtraction.work_card_id.in_(card_ids)).delete(synchronize_session=False)
        WorkCardFile.query.filter(WorkCardFile.work_card_id.in_(card_ids)).delete(synchronize_session=False)
        WorkCard.query.filter(WorkCard.id.in_(card_ids)).delete(synchronize_session=False)
    if emp_ids:
        Employee.query.filter(Employee.id.in_(emp_ids)).delete(synchronize_session=False)
    if site_ids:
        Site.query.filter(Site.id.in_(site_ids)).delete(synchronize_session=False)
    db.session.commit()
    return len(site_ids), len(emp_ids), len(card_ids)


def build():
    biz = Business.query.filter_by(code=TARGET_CODE).first()
    admin = User.query.filter_by(email=ADMIN_EMAIL, business_id=biz.id).first() if biz else None
    if not biz or not admin:
        sys.exit(f"Business '{TARGET_CODE}' with admin {ADMIN_EMAIL} not found")

    removed = cleanup(biz)
    if '--cleanup' in sys.argv:
        print(f'Removed {removed[0]} demo sites, {removed[1]} demo employees, {removed[2]} demo cards')
        return

    def site(letter, name, tariff):
        s = Site(business_id=biz.id, site_name=name, site_code=f'{SITE_PREFIX}{letter}',
                 is_active=True, hourly_tariff=tariff)
        db.session.add(s)
        db.session.flush()
        return s

    x = site('X', 'הדגמה אתר אחר – X', 50)
    y = site('Y', 'הדגמה אתר אחר – Y', 55)
    z = site('Z', 'הדגמה אתר אחר – Z', 60)

    def employee(case, name, home):
        e = Employee(business_id=biz.id, site_id=home.id, full_name=name,
                     passport_id=f'{PASSPORT_TAG}{case}', external_employee_id=f'OS-{case}',
                     is_active=True, status='ACTIVE')
        db.session.add(e)
        db.session.flush()
        return e

    def card(emp, home, days):
        """days: list of (day, site, hours, status). Saturdays are skipped."""
        c = WorkCard(business_id=biz.id, site_id=home.id, employee_id=emp.id,
                     processing_month=MONTH, source='ADMIN_SINGLE', review_status='APPROVED',
                     approved_by_user_id=admin.id, approved_at=APPROVED_AT)
        db.session.add(c)
        db.session.flush()
        last = 0
        for d, s, hours, status in days:
            if is_sat(d) and status is None:
                continue
            db.session.add(WorkCardDayEntry(
                work_card_id=c.id, day_of_month=d, source='MANUAL',
                from_time=None if status else time(7, 0),
                to_time=None if status else time(7 + int(hours), 0),
                total_hours=None if status else hours, day_status=status,
                attributed_site_id=None if s is home else s.id, is_valid=True,
            ))
            last = max(last, d)
        c.approved_through_day = last
        db.session.flush()

    def span(a, b, s, hours=8):
        return [(d, s, hours, None) for d in range(a, b + 1)]

    a = employee('A', 'הדגמה A – X ואז Y', x)
    card(a, x, span(1, 8, x) + span(9, 15, y))

    b = employee('B', 'הדגמה B – שלושה אתרים', x)
    card(b, x, span(1, 5, x) + span(6, 10, y, 9) + span(11, 15, z, 7))

    c = employee('C', 'הדגמה C – חופשה', y)
    card(c, y, span(1, 10, y) + [(11, x, None, 'VACATION')])

    d = employee('D', 'הדגמה D – רק X', x)
    card(d, x, span(1, 12, x))

    db.session.commit()

    base = f'http://localhost:5173/{TARGET_CODE}'
    q = 'tab=summary&selectedMonth=2026-11'
    print(f"\nDemo data added to '{biz.name}' ({TARGET_CODE}) for November 2026. Login: {ADMIN_EMAIL}\n")
    print(f'  Site X:  {base}/sites/{x.id}?{q}')
    print(f'  Site Y:  {base}/sites/{y.id}?{q}')
    print(f'  Site Z:  {base}/sites/{z.id}?{q}')
    print(f'  All sites (batch export): {base}/sites\n')
    print('  Expected:')
    print('    X: A hours 1-8, marker 9-15 | B hours 1-5, marker 6-15 | D hours 1-12, no marker')
    print('       C: vacation on 11, marker 1-10 (the vacation day tagged to X makes C a column there)')
    print('    Y: A hours 9-15, marker 1-8 | B hours 6-10, marker 1-5 & 11-15 | C hours 1-10, no marker (11 is vacation)')
    print('    Z: B hours 11-15, marker 1-10')
    print('    (Saturdays Nov 7 and 14 have no hours anywhere, so no marker on them.)')
    print('\nRe-run to reset; add --cleanup to remove.')


if __name__ == '__main__':
    app = create_app()
    with app.app_context():
        build()
