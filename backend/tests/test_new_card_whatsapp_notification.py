"""Tests for the 'new card arrived' WhatsApp notification feature.

Covers two pieces:
  * the notifier service (worker hook) — app/services/work_card_notifier.py
  * the settings API — GET/PUT /api/whatsapp/notification-settings

The listener client is mocked everywhere — we assert wiring (window check, dedup,
recipient resolution, image vs document, error mapping), not real WhatsApp delivery.
"""
import unittest
import uuid
from datetime import date, datetime, timezone
from unittest.mock import MagicMock, patch

from dotenv import load_dotenv

load_dotenv()

from backend.app import create_app, db
from backend.app.auth_utils import encode_auth_token
from backend.app.models.business import Business
from backend.app.models.users import User
from backend.app.models.whatsapp import WhatsAppNotificationSettings
from backend.app.models.work_cards import WorkCard, WorkCardFile
from backend.app.repositories.whatsapp_repository import WhatsAppNotificationSettingsRepository
from backend.app.services.work_card_notifier import maybe_notify_new_card

# 2026-06-05 12:00 UTC → 5th in Asia/Jerusalem (UTC+3 in summer).
IN_WINDOW_TS = datetime(2026, 6, 5, 12, 0, tzinfo=timezone.utc)
# 2026-06-20 12:00 UTC → 20th in Asia/Jerusalem.
OUT_WINDOW_TS = datetime(2026, 6, 20, 12, 0, tzinfo=timezone.utc)

NOTIFIER_CLIENT = 'backend.app.services.work_card_notifier.WhatsAppListenerClient'


class _BaseWA(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.client = self.app.test_client()
        self.ctx = self.app.app_context()
        self.ctx.push()

        suffix = uuid.uuid4().hex[:8]
        self.business = Business(name=f'WA Biz {suffix}', code=f'wabiz-{suffix}', is_active=True)
        db.session.add(self.business)
        db.session.flush()

        self.admin = User(
            full_name='Admin', email=f'admin_{suffix}@example.com',
            role='ADMIN', business_id=self.business.id, is_active=True,
            phone_number=f'05010{suffix[:5]}',
        )
        db.session.add(self.admin)
        db.session.flush()
        db.session.commit()

        token = encode_auth_token(str(self.admin.id))
        self.headers = {'Authorization': f'Bearer {token}'}

    def tearDown(self):
        try:
            for c in WorkCard.query.filter_by(business_id=self.business.id).all():
                db.session.delete(c)
            WhatsAppNotificationSettings.query.filter_by(business_id=self.business.id).delete()
            for u in User.query.filter_by(business_id=self.business.id).all():
                db.session.delete(u)
            db.session.delete(Business.query.get(self.business.id))
            db.session.commit()
        except Exception:
            db.session.rollback()
        self.ctx.pop()

    def _make_card(self, created_at=IN_WINDOW_TS, content_type='image/jpeg', image=b'JPEG'):
        card = WorkCard(
            business_id=self.business.id, processing_month=date(2026, 6, 1),
            source='WHATSAPP', review_status='NEEDS_ASSIGNMENT',
            original_filename='card.jpg', created_at=created_at,
        )
        db.session.add(card)
        db.session.flush()
        if image is not None:
            db.session.add(WorkCardFile(
                work_card_id=card.id, content_type=content_type, file_name='card.jpg',
                file_size_bytes=len(image), image_bytes=image,
            ))
        db.session.commit()
        return card

    def _set_settings(self, **kwargs):
        defaults = dict(
            business_id=self.business.id, enabled=True, start_day=3, end_day=7,
            destination_user_ids=[str(self.admin.id)],
        )
        defaults.update(kwargs)
        row = WhatsAppNotificationSettings(**defaults)
        db.session.add(row)
        db.session.commit()
        return row


class NotifierServiceTests(_BaseWA):
    @patch(NOTIFIER_CLIENT)
    def test_sends_image_in_window_and_sets_notified_at(self, MockClient):
        mock_client = MagicMock()
        MockClient.from_env.return_value = mock_client
        self._set_settings()
        card = self._make_card()

        maybe_notify_new_card(card)

        mock_client.send_image.assert_called_once()
        mock_client.send_document.assert_not_called()
        kwargs = mock_client.send_image.call_args.kwargs
        self.assertTrue(kwargs['chat_id'].endswith('@s.whatsapp.net'))
        self.assertEqual(kwargs['file_bytes'], b'JPEG')
        self.assertIn('כרטיס עבודה חדש', kwargs['caption'])
        self.assertIsNotNone(card.whatsapp_notified_at)

    @patch(NOTIFIER_CLIENT)
    def test_out_of_window_does_not_send(self, MockClient):
        mock_client = MagicMock()
        MockClient.from_env.return_value = mock_client
        self._set_settings(start_day=10, end_day=15)
        card = self._make_card(created_at=IN_WINDOW_TS)  # day 5, outside 10–15

        maybe_notify_new_card(card)

        mock_client.send_image.assert_not_called()
        self.assertIsNone(card.whatsapp_notified_at)

    @patch(NOTIFIER_CLIENT)
    def test_disabled_does_not_send(self, MockClient):
        mock_client = MagicMock()
        MockClient.from_env.return_value = mock_client
        self._set_settings(enabled=False)
        card = self._make_card()

        maybe_notify_new_card(card)
        mock_client.send_image.assert_not_called()

    @patch(NOTIFIER_CLIENT)
    def test_no_recipients_does_not_send(self, MockClient):
        mock_client = MagicMock()
        MockClient.from_env.return_value = mock_client
        self._set_settings(destination_user_ids=[])
        card = self._make_card()

        maybe_notify_new_card(card)
        mock_client.send_image.assert_not_called()

    @patch(NOTIFIER_CLIENT)
    def test_recipient_without_phone_skipped(self, MockClient):
        mock_client = MagicMock()
        MockClient.from_env.return_value = mock_client
        nophone = User(
            full_name='No Phone', email=f'np_{uuid.uuid4().hex[:8]}@example.com',
            role='ADMIN', business_id=self.business.id, is_active=True, phone_number=None,
        )
        db.session.add(nophone)
        db.session.commit()
        self._set_settings(destination_user_ids=[str(nophone.id)])
        card = self._make_card()

        maybe_notify_new_card(card)
        mock_client.send_image.assert_not_called()
        # No successful send → not marked notified.
        self.assertIsNone(card.whatsapp_notified_at)

    @patch(NOTIFIER_CLIENT)
    def test_pdf_sent_as_document(self, MockClient):
        mock_client = MagicMock()
        MockClient.from_env.return_value = mock_client
        self._set_settings()
        card = self._make_card(content_type='application/pdf', image=b'%PDF')

        maybe_notify_new_card(card)
        mock_client.send_document.assert_called_once()
        mock_client.send_image.assert_not_called()
        self.assertTrue(mock_client.send_document.call_args.kwargs['filename'].endswith('.pdf'))

    @patch(NOTIFIER_CLIENT)
    def test_already_notified_is_not_resent(self, MockClient):
        mock_client = MagicMock()
        MockClient.from_env.return_value = mock_client
        self._set_settings()
        card = self._make_card()
        card.whatsapp_notified_at = datetime(2026, 6, 5, 13, 0, tzinfo=timezone.utc)
        db.session.commit()

        maybe_notify_new_card(card)
        mock_client.send_image.assert_not_called()
        MockClient.from_env.assert_not_called()

    @patch(NOTIFIER_CLIENT)
    def test_no_settings_row_does_not_send(self, MockClient):
        mock_client = MagicMock()
        MockClient.from_env.return_value = mock_client
        card = self._make_card()

        maybe_notify_new_card(card)
        mock_client.send_image.assert_not_called()


class NotificationSettingsApiTests(_BaseWA):
    URL = '/api/whatsapp/notification-settings'

    def test_get_returns_defaults_when_unset(self):
        resp = self.client.get(self.URL, headers=self.headers)
        self.assertEqual(resp.status_code, 200)
        data = resp.get_json()['data']
        self.assertFalse(data['enabled'])
        self.assertEqual(data['destination_user_ids'], [])

    def test_put_upsert_round_trip(self):
        body = {
            'enabled': True, 'start_day': 3, 'end_day': 7,
            'destination_user_ids': [str(self.admin.id)],
        }
        resp = self.client.put(self.URL, json=body, headers=self.headers)
        self.assertEqual(resp.status_code, 200)

        got = self.client.get(self.URL, headers=self.headers).get_json()['data']
        self.assertTrue(got['enabled'])
        self.assertEqual(got['start_day'], 3)
        self.assertEqual(got['end_day'], 7)
        self.assertEqual(got['destination_user_ids'], [str(self.admin.id)])

        # A second PUT updates the same row (upsert, not duplicate).
        self.client.put(self.URL, json={**body, 'end_day': 9}, headers=self.headers)
        rows = WhatsAppNotificationSettings.query.filter_by(business_id=self.business.id).all()
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0].end_day, 9)

    def test_put_rejects_bad_days(self):
        for bad in ({'start_day': 0, 'end_day': 7}, {'start_day': 3, 'end_day': 32}):
            body = {'enabled': True, 'destination_user_ids': [str(self.admin.id)], **bad}
            resp = self.client.put(self.URL, json=body, headers=self.headers)
            self.assertEqual(resp.status_code, 400)

    def test_put_rejects_enabled_without_recipients(self):
        body = {'enabled': True, 'start_day': 3, 'end_day': 7, 'destination_user_ids': []}
        resp = self.client.put(self.URL, json=body, headers=self.headers)
        self.assertEqual(resp.status_code, 400)

    def test_put_rejects_foreign_user(self):
        other_biz = Business(name='Other', code=f'other-{uuid.uuid4().hex[:8]}', is_active=True)
        db.session.add(other_biz)
        db.session.flush()
        foreigner = User(
            full_name='Foreigner', email=f'f_{uuid.uuid4().hex[:8]}@example.com',
            role='ADMIN', business_id=other_biz.id, is_active=True,
        )
        db.session.add(foreigner)
        db.session.commit()

        body = {
            'enabled': True, 'start_day': 3, 'end_day': 7,
            'destination_user_ids': [str(foreigner.id)],
        }
        resp = self.client.put(self.URL, json=body, headers=self.headers)
        self.assertEqual(resp.status_code, 400)

        db.session.delete(foreigner)
        db.session.delete(Business.query.get(other_biz.id))
        db.session.commit()


if __name__ == '__main__':
    unittest.main()
