import unittest
import uuid
from datetime import date, time

from dotenv import load_dotenv
load_dotenv()

from backend.app import create_app, db
from backend.app.models.business import Business
from backend.app.models.users import User
from backend.app.models.sites import Site, Employee
from backend.app.models.work_cards import (
    WorkCard, WorkCardFile, WorkCardExtraction, WorkCardDayEntry,
)
from backend.app.models.audit import ExportRun, AuditEvent
from backend.app.models.upload_access import UploadAccessRequest
from backend.app.models.whatsapp import (
    WhatsAppGroupConfig, WhatsAppNotificationSettings, WhatsAppIngestedMessage,
)
from backend.app.models.telegram import TelegramBotConfig, TelegramIngestedFile
from backend.app.repositories.business_repository import BusinessRepository


class BusinessHardDeleteTests(unittest.TestCase):
    """A fully-populated business must hard-delete cleanly in one call — the
    child FKs are NOT NULL and several rows point at work_cards, so a plain
    session.delete(business) raises. hard_delete() tears the whole graph down."""

    def setUp(self):
        self.app = create_app()
        self.ctx = self.app.app_context()
        self.ctx.push()
        self.tag = uuid.uuid4().hex[:8]

    def tearDown(self):
        # Best-effort: if the test itself failed before deleting, clean up.
        try:
            b = Business.query.filter_by(code=f"hd_{self.tag}").first()
            if b:
                BusinessRepository().hard_delete(b.id)
        except Exception:
            db.session.rollback()
        self.ctx.pop()

    def _populate(self):
        s = db.session
        biz = Business(name=f"HD {self.tag}", code=f"hd_{self.tag}")
        s.add(biz); s.flush()
        user = User(business_id=biz.id, email=f"hd_{self.tag}@t.io", full_name='U',
                    role='ADMIN', password_hash='x')
        s.add(user); s.flush()
        site = Site(business_id=biz.id, site_name=f"S {self.tag}", site_code=f"S{self.tag[:4]}")
        s.add(site); s.flush()
        emp = Employee(business_id=biz.id, site_id=site.id, full_name='E', passport_id=f"P{self.tag}")
        s.add(emp); s.flush()
        # Exercise a populated sites.field_manager_id (a user FK, ON DELETE SET
        # NULL) so the teardown covers a site that still points at a user.
        site.field_manager_id = user.id
        s.flush()
        month = date(2026, 6, 1)
        card = WorkCard(business_id=biz.id, site_id=site.id, employee_id=emp.id,
                        processing_month=month, source='ADMIN_SINGLE', review_status='NEEDS_REVIEW')
        s.add(card); s.flush()
        s.add(WorkCardDayEntry(work_card_id=card.id, day_of_month=3, total_hours=8,
                               from_time=time(9, 0), to_time=time(17, 0), source='MANUAL', is_valid=True))
        s.add(WorkCardFile(work_card_id=card.id, content_type='image/png', file_size_bytes=3, image_bytes=b'abc'))
        s.add(WorkCardExtraction(work_card_id=card.id, status='DONE'))
        # Rows referencing the work_card via no-ON-DELETE FKs (the blockers).
        s.add(WhatsAppIngestedMessage(message_id=f"m{self.tag}", chat_id='c', status='INGESTED', work_card_id=card.id))
        s.add(TelegramIngestedFile(file_unique_id=f"f{self.tag}", status='INGESTED', work_card_id=card.id))
        # Business-owned peripheral rows.
        s.add(AuditEvent(business_id=biz.id, event_type='APPROVE', entity_type='WORK_CARD',
                         entity_id=card.id, work_card_id=card.id, employee_id=emp.id,
                         site_id=site.id, actor_user_id=user.id))
        s.add(ExportRun(business_id=biz.id, processing_month=month, site_id=site.id, exported_by_user_id=user.id))
        s.add(UploadAccessRequest(token=f"t{self.tag}", business_id=biz.id, site_id=site.id,
                                  employee_id=emp.id, processing_month=month, created_by_user_id=user.id))
        s.add(WhatsAppGroupConfig(business_id=biz.id, chat_id=f"wa{self.tag}"))
        s.add(WhatsAppNotificationSettings(business_id=biz.id))
        s.add(TelegramBotConfig(business_id=biz.id, telegram_chat_id=int(self.tag, 16), current_processing_month=month))
        s.commit()
        return biz.id, card.id

    def test_hard_delete_removes_business_and_all_children(self):
        biz_id, card_id = self._populate()

        ok = BusinessRepository().hard_delete(biz_id)
        self.assertTrue(ok)

        # Business gone.
        self.assertIsNone(Business.query.get(biz_id))
        # Every dependent table scoped to the business/card is empty.
        self.assertEqual(User.query.filter_by(business_id=biz_id).count(), 0)
        self.assertEqual(Site.query.filter_by(business_id=biz_id).count(), 0)
        self.assertEqual(Employee.query.filter_by(business_id=biz_id).count(), 0)
        self.assertEqual(WorkCard.query.filter_by(business_id=biz_id).count(), 0)
        self.assertEqual(WorkCardDayEntry.query.filter_by(work_card_id=card_id).count(), 0)
        self.assertEqual(WorkCardFile.query.filter_by(work_card_id=card_id).count(), 0)
        self.assertEqual(WorkCardExtraction.query.filter_by(work_card_id=card_id).count(), 0)
        self.assertEqual(WhatsAppIngestedMessage.query.filter_by(work_card_id=card_id).count(), 0)
        self.assertEqual(TelegramIngestedFile.query.filter_by(work_card_id=card_id).count(), 0)
        self.assertEqual(AuditEvent.query.filter_by(business_id=biz_id).count(), 0)
        self.assertEqual(ExportRun.query.filter_by(business_id=biz_id).count(), 0)
        self.assertEqual(UploadAccessRequest.query.filter_by(business_id=biz_id).count(), 0)
        self.assertEqual(WhatsAppGroupConfig.query.filter_by(business_id=biz_id).count(), 0)
        self.assertEqual(WhatsAppNotificationSettings.query.filter_by(business_id=biz_id).count(), 0)
        self.assertEqual(TelegramBotConfig.query.filter_by(business_id=biz_id).count(), 0)

    def test_hard_delete_missing_business_returns_false(self):
        self.assertFalse(BusinessRepository().hard_delete(uuid.uuid4()))


if __name__ == '__main__':
    unittest.main()
