"""Seed demo data for trying the work card images in the report editor.

Adds one demo site (site_code REPCARDS) to the business that admin@example.com
logs into (code `automatehq`), with one employee per scenario and November 2026
work cards: one card, several cards, approved/pending/rejected mixes, a
hand-entered card with no image, and enough cards to overflow the thumbnail
strip.

Every image is a placeholder that says which card it is ("CARD 2 OF 3") and the
position it should take in the editor's thumbnail strip, so the ordering can be
checked by eye. The strip follows the report's own choice of card: approved
first, then the newest; card 1 is the one the report's hours come from.

No AI call is made: extraction records and day entries are written directly.

Usage (from repo root):
    set -a && . ./.env && set +a
    PYTHONPATH=. venv/bin/python scripts/seed_report_cards_demo.py            # (re)create
    PYTHONPATH=. venv/bin/python scripts/seed_report_cards_demo.py --cleanup  # remove it

Idempotent: earlier demo rows are removed and rebuilt on every run.
"""
import hashlib
import sys
from dataclasses import dataclass
from datetime import date, datetime, time, timedelta, timezone

import cv2
import numpy as np

from backend.app import create_app, db
from backend.app.models import Business, Employee, Site, User, WorkCard, WorkCardDayEntry
from backend.app.models.audit import AuditEvent
from backend.app.models.work_cards import WorkCardExtraction, WorkCardFile

TARGET_CODE = 'automatehq'
ADMIN_EMAIL = 'admin@example.com'
SITE_CODE = 'REPCARDS'
SITE_NAME = 'הדגמה – כרטיסים בדוח'
PASSPORT_TAG = 'REPCARDS'
FILE_TAG = 'repcards_'

MONTH = date(2026, 11, 1)
MONTH_PARAM = '2026-11'
DAYS_IN_MONTH = 30

# Header colour per card, so switching cards is obvious at a glance (BGR).
HEADER_COLOURS = [(150, 90, 20), (40, 120, 40), (30, 60, 170), (120, 40, 120), (20, 120, 160), (90, 90, 90)]


@dataclass
class CardSpec:
    status: str            # APPROVED / NEEDS_REVIEW / REJECTED
    uploaded_day: int      # day of November 2026 the card arrived
    days: tuple            # (first, last) day of the month the card covers
    manual: bool = False   # entered by hand: no image
    note: str = ''


def is_saturday(day):
    return date(MONTH.year, MONTH.month, day).weekday() == 5


def rows_for(first, last):
    return [{'day': d, 'start_time': '07:00', 'end_time': '16:00', 'total_hours': 9.0,
             'row_state': 'WORKED', 'confidence': 0.95}
            for d in range(first, last + 1) if not is_saturday(d)]


def uploaded_at(day, hour=10):
    return datetime(2026, 11, day, hour, tzinfo=timezone.utc)


def report_order(specs):
    """The order the report (and the thumbnail strip) puts the cards in."""
    return sorted(range(len(specs)), key=lambda i: (specs[i].status != 'APPROVED', -specs[i].uploaded_day))


def placeholder_png(case, number, total, position, spec, rows):
    """A white 'timesheet' that says which card it is and where it should show."""
    h = 300 + 30 * len(rows)
    img = np.full((h, 760, 3), 255, np.uint8)
    font = cv2.FONT_HERSHEY_SIMPLEX
    cv2.rectangle(img, (0, 0), (759, 96), HEADER_COLOURS[(number - 1) % len(HEADER_COLOURS)], -1)
    cv2.putText(img, f'CARD {number} OF {total}', (24, 62), font, 1.6, (255, 255, 255), 3, cv2.LINE_AA)
    cv2.putText(img, f'Employee: Demo {case}', (24, 136), font, 0.7, (0, 0, 0), 2, cv2.LINE_AA)
    cv2.putText(img, f'Status: {spec.status}   Uploaded: {spec.uploaded_day}.11.2026', (24, 168), font, 0.6, (60, 60, 60), 1, cv2.LINE_AA)
    cv2.putText(img, f'Expected thumbnail position in the report editor: {position}', (24, 200), font, 0.6, (0, 0, 200), 2, cv2.LINE_AA)
    y = 250
    for x, label in ((24, 'Day'), (150, 'In'), (300, 'Out'), (450, 'Total')):
        cv2.putText(img, label, (x, y), font, 0.6, (0, 0, 0), 2, cv2.LINE_AA)
    cv2.line(img, (20, y + 10), (740, y + 10), (0, 0, 0), 2)
    for r in rows:
        y += 30
        for x, value in ((24, str(r['day'])), (150, r['start_time']), (300, r['end_time']), (450, f"{r['total_hours']:g}")):
            cv2.putText(img, value, (x, y), font, 0.6, (40, 40, 40), 1, cv2.LINE_AA)
        cv2.line(img, (20, y + 9), (740, y + 9), (215, 215, 215), 1)
    ok, buf = cv2.imencode('.png', img)
    assert ok
    return buf.tobytes()


class Seeder:
    def __init__(self, business, admin, site):
        self.business = business
        self.admin = admin
        self.site = site
        self.log = []

    def employee(self, case, name):
        emp = Employee(
            business_id=self.business.id, site_id=self.site.id, full_name=name,
            passport_id=f'{PASSPORT_TAG}{case}', external_employee_id=f'RC-{case}',
            is_active=True, status='ACTIVE',
        )
        db.session.add(emp)
        db.session.flush()
        return emp

    def cards(self, case, emp, specs, expect):
        order = report_order(specs)
        position = {index: pos + 1 for pos, index in enumerate(order)}
        for number, spec in enumerate(specs, start=1):
            self._card(case, emp, number, len(specs), position[number - 1], spec)
        self.log.append((case, emp.full_name, len(specs), expect))

    def _card(self, case, emp, number, total, position, spec):
        rows = rows_for(*spec.days)
        created = uploaded_at(spec.uploaded_day)
        png = None if spec.manual else placeholder_png(case, number, total, position, spec, rows)
        card = WorkCard(
            business_id=self.business.id, site_id=self.site.id, employee_id=emp.id,
            processing_month=MONTH,
            source='MANUAL' if spec.manual else 'WHATSAPP',
            uploaded_by_user_id=self.admin.id if spec.manual else None,
            original_filename=None if spec.manual else f'{FILE_TAG}{case}_card{number}.png',
            mime_type=None if spec.manual else 'image/png',
            file_size_bytes=len(png) if png else None,
            sha256_hash=hashlib.sha256(png).hexdigest() if png else None,
            review_status=spec.status,
            notes=spec.note or None,
            created_at=created,
        )
        db.session.add(card)
        db.session.flush()
        if png:
            db.session.add(WorkCardFile(
                work_card_id=card.id, content_type='image/png',
                file_name=card.original_filename, file_size_bytes=len(png), image_bytes=png,
            ))
            db.session.add(WorkCardExtraction(
                work_card_id=card.id, status='DONE', extraction_mode='FULL', attempts=1,
                started_at=created, finished_at=created + timedelta(seconds=20),
                extracted_employee_name=emp.full_name, extracted_passport_id=emp.passport_id,
                normalized_result_jsonb={'entries': rows},
                matched_employee_id=emp.id, match_method='passport_exact', match_confidence=1,
                model_name='demo-seed', pipeline_version='demo',
            ))
        for r in rows:
            db.session.add(WorkCardDayEntry(
                work_card_id=card.id, day_of_month=r['day'],
                source='MANUAL' if spec.manual else 'EXTRACTED',
                from_time=time(7, 0), to_time=time(16, 0), total_hours=r['total_hours'], is_valid=True,
            ))
        if spec.status == 'APPROVED':
            card.approved_by_user_id = self.admin.id
            card.approved_at = created + timedelta(hours=2)
            card.approved_through_day = spec.days[1]
        db.session.flush()


def cleanup(biz):
    """Remove every demo-tagged row from `biz`."""
    emp_ids = [e.id for e in Employee.query.filter(
        Employee.business_id == biz.id, Employee.passport_id.like(f'{PASSPORT_TAG}%'))]
    card_ids = [c.id for c in WorkCard.query.filter(WorkCard.business_id == biz.id, WorkCard.employee_id.in_(emp_ids))] if emp_ids else []
    if card_ids:
        AuditEvent.query.filter(AuditEvent.work_card_id.in_(card_ids)).delete(synchronize_session=False)
        WorkCardDayEntry.query.filter(WorkCardDayEntry.work_card_id.in_(card_ids)).delete(synchronize_session=False)
        WorkCardExtraction.query.filter(WorkCardExtraction.work_card_id.in_(card_ids)).delete(synchronize_session=False)
        WorkCardFile.query.filter(WorkCardFile.work_card_id.in_(card_ids)).delete(synchronize_session=False)
        WorkCard.query.filter(WorkCard.id.in_(card_ids)).delete(synchronize_session=False)
    if emp_ids:
        Employee.query.filter(Employee.id.in_(emp_ids)).delete(synchronize_session=False)
    sites = Site.query.filter(Site.business_id == biz.id, Site.site_code == SITE_CODE).delete(synchronize_session=False)
    db.session.commit()
    return len(emp_ids), len(card_ids), sites


def build():
    biz = Business.query.filter_by(code=TARGET_CODE).first()
    admin = User.query.filter_by(email=ADMIN_EMAIL, business_id=biz.id).first() if biz else None
    if not biz or not admin:
        sys.exit(f"Business '{TARGET_CODE}' with admin {ADMIN_EMAIL} not found")

    removed = cleanup(biz)
    if '--cleanup' in sys.argv:
        print(f'Removed {removed[0]} demo employees, {removed[1]} demo cards, {removed[2]} demo site')
        return

    site = Site(business_id=biz.id, site_name=SITE_NAME, site_code=SITE_CODE, is_active=True)
    db.session.add(site)
    db.session.flush()
    s = Seeder(biz, admin, site)

    s.cards('A', s.employee('A', 'הדגמה A – כרטיס אחד'), [
        CardSpec('APPROVED', 3, (1, DAYS_IN_MONTH)),
    ], 'One card: the image shows straight away, no thumbnail strip.')

    s.cards('B', s.employee('B', 'הדגמה B – מאושר ישן + חדש ממתין'), [
        CardSpec('APPROVED', 5, (1, DAYS_IN_MONTH)),
        CardSpec('NEEDS_REVIEW', 20, (1, DAYS_IN_MONTH)),
    ], 'Strip "1 / 2". Thumbnail 1 is CARD 1 (approved, older): approved beats newer. '
       'It has the table icon and "השעות בדוח נלקחות מכרטיס זה".')

    s.cards('C', s.employee('C', 'הדגמה C – שלושה כרטיסים ממתינים'), [
        CardSpec('NEEDS_REVIEW', 10, (1, 10)),
        CardSpec('NEEDS_REVIEW', 20, (11, 20)),
        CardSpec('NEEDS_REVIEW', 28, (21, DAYS_IN_MONTH)),
    ], 'Strip "1 / 3", newest first: thumbnails show CARD 3, CARD 2, CARD 1. '
       'Arrows and clicking a thumbnail switch the big image.')

    s.cards('D', s.employee('D', 'הדגמה D – כולל כרטיס שנדחה'), [
        CardSpec('REJECTED', 22, (1, DAYS_IN_MONTH), note='Blurry photo'),
        CardSpec('NEEDS_REVIEW', 12, (1, DAYS_IN_MONTH)),
    ], 'Strip "1 / 2": the rejected card is newer, so it is first (the report does the same). '
       'Red status dot and "נדחה" on it, amber on the other.')

    s.cards('E', s.employee('E', 'הדגמה E – כרטיס ידני ללא תמונה'), [
        CardSpec('NEEDS_REVIEW', 6, (1, 15)),
        CardSpec('NEEDS_REVIEW', 25, (16, DAYS_IN_MONTH), manual=True),
    ], 'Thumbnail 1 is the hand-entered card (newer): a note icon, and the viewer says '
       '"כרטיס שהוזן ידנית — אין לו תמונה". Thumbnail 2 is the photo.')

    s.cards('F', s.employee('F', 'הדגמה F – שישה כרטיסים'), [
        CardSpec('NEEDS_REVIEW', day, (1, DAYS_IN_MONTH)) for day in (4, 8, 12, 16, 20, 24)
    ], 'Six cards: the strip scrolls sideways in a narrow pane. Thumbnails run CARD 6 down to CARD 1.')

    db.session.commit()

    editor = f'http://localhost:5173/{TARGET_CODE}/sites/{site.id}/reports?type=summary&month={MONTH_PARAM}'
    viewer = f'http://localhost:5173/{TARGET_CODE}/sites/{site.id}/reports/cards?month={MONTH_PARAM}'
    print(f"\nDemo data added to business '{biz.name}' (code: {TARGET_CODE}), site '{site.site_name}'.")
    print(f"  Login:   {ADMIN_EMAIL} (your existing login)")
    print(f"  Editor:  {editor}")
    print(f"  Viewer:  {viewer}")
    print("  Click any day cell in an employee's column; the pane on the left shows that employee's cards.\n")
    for case, name, count, expect in s.log:
        print(f"  {case}  {name}  ({count} card{'s' if count > 1 else ''})\n     expect: {expect}\n")
    print("Re-run this script to reset, or pass --cleanup to remove it.")


if __name__ == '__main__':
    app = create_app()
    with app.app_context():
        build()
