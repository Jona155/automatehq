"""Tests for POST /api/work_cards/<id>/send-whatsapp.

Forwards a work card's stored image + an optional note to a WhatsApp group via
the listener. The listener client is mocked — we assert the wiring (tenancy,
missing image, note-as-caption, error mapping), not real WhatsApp delivery.
"""
import unittest
import uuid
from datetime import date
from unittest.mock import MagicMock, patch

from dotenv import load_dotenv

load_dotenv()

from backend.app import create_app, db
from backend.app.auth_utils import encode_auth_token
from backend.app.models.business import Business
from backend.app.models.sites import Site, Employee
from backend.app.models.users import User
from backend.app.models.work_cards import WorkCard, WorkCardFile
from backend.app.services.whatsapp_listener_client import (
    WhatsAppNotConnectedError,
    WhatsAppPayloadTooLargeError,
)

GROUP_CHAT_ID = '123456789-987654321@g.us'


class SendWorkCardWhatsAppTests(unittest.TestCase):
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
        )
        db.session.add(self.admin)
        db.session.flush()

        self.site = Site(site_name=f'Site {suffix}', business_id=self.business.id, hourly_tariff=50)
        db.session.add(self.site)
        db.session.flush()

        self.employee = Employee(
            business_id=self.business.id, site_id=self.site.id,
            full_name='David Levi', passport_id=f'P{suffix}',
        )
        db.session.add(self.employee)
        db.session.flush()

        self.month = date(2026, 5, 1)

        # Card with an image, and a manual card with no image file.
        self.card = self._make_card(with_file=True)
        self.manual_card = self._make_card(with_file=False, source='MANUAL')
        db.session.commit()

        self.card_id = self.card.id
        self.manual_card_id = self.manual_card.id

        token = encode_auth_token(str(self.admin.id))
        self.headers = {'Authorization': f'Bearer {token}'}

    def _make_card(self, with_file, source='ADMIN_SINGLE'):
        card = WorkCard(
            business_id=self.business.id, site_id=self.site.id, employee_id=self.employee.id,
            processing_month=self.month, source=source, review_status='NEEDS_REVIEW',
            original_filename='card.jpg',
        )
        db.session.add(card)
        db.session.flush()
        if with_file:
            db.session.add(WorkCardFile(
                work_card_id=card.id, content_type='image/jpeg', file_name='card.jpg',
                file_size_bytes=4, image_bytes=b'JPEG',
            ))
        return card

    def tearDown(self):
        try:
            for c in WorkCard.query.filter_by(business_id=self.business.id).all():
                db.session.delete(c)
            for e in Employee.query.filter_by(business_id=self.business.id).all():
                db.session.delete(e)
            for s in Site.query.filter_by(business_id=self.business.id).all():
                db.session.delete(s)
            for u in User.query.filter_by(business_id=self.business.id).all():
                db.session.delete(u)
            db.session.delete(Business.query.get(self.business.id))
            db.session.commit()
        except Exception:
            db.session.rollback()
        self.ctx.pop()

    def _send(self, card_id, body):
        return self.client.post(
            f'/api/work_cards/{card_id}/send-whatsapp', json=body, headers=self.headers,
        )

    @patch('backend.app.api.work_cards.WhatsAppListenerClient')
    def test_sends_image_inline_with_note_as_caption(self, MockClient):
        mock_client = MagicMock()
        MockClient.from_env.return_value = mock_client

        resp = self._send(self.card_id, {'chat_id': GROUP_CHAT_ID, 'note': 'מה כתוב ביום 5?'})
        self.assertEqual(resp.status_code, 200)

        # image/* content goes out as an inline photo, not a file attachment.
        mock_client.send_image.assert_called_once()
        mock_client.send_document.assert_not_called()
        kwargs = mock_client.send_image.call_args.kwargs
        self.assertEqual(kwargs['chat_id'], GROUP_CHAT_ID)
        self.assertEqual(kwargs['file_bytes'], b'JPEG')
        self.assertEqual(kwargs['caption'], 'מה כתוב ביום 5?')
        self.assertEqual(kwargs['mimetype'], 'image/jpeg')

    @patch('backend.app.api.work_cards.WhatsAppListenerClient')
    def test_blank_note_sends_no_caption(self, MockClient):
        mock_client = MagicMock()
        MockClient.from_env.return_value = mock_client

        resp = self._send(self.card_id, {'chat_id': GROUP_CHAT_ID, 'note': '   '})
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(mock_client.send_image.call_args.kwargs['caption'])

    @patch('backend.app.api.work_cards.WhatsAppListenerClient')
    def test_pdf_card_sent_as_document(self, MockClient):
        mock_client = MagicMock()
        MockClient.from_env.return_value = mock_client

        # A non-image file (PDF) can't render inline — falls back to document.
        pdf_card = self._make_card(with_file=False)
        db.session.add(WorkCardFile(
            work_card_id=pdf_card.id, content_type='application/pdf', file_name='card.pdf',
            file_size_bytes=4, image_bytes=b'%PDF',
        ))
        db.session.commit()

        resp = self._send(pdf_card.id, {'chat_id': GROUP_CHAT_ID})
        self.assertEqual(resp.status_code, 200)
        mock_client.send_document.assert_called_once()
        mock_client.send_image.assert_not_called()
        self.assertTrue(mock_client.send_document.call_args.kwargs['filename'].endswith('.pdf'))

    @patch('backend.app.api.work_cards.WhatsAppListenerClient')
    def test_rejects_non_group_chat_id(self, MockClient):
        resp = self._send(self.card_id, {'chat_id': '15551234567@c.us', 'note': 'x'})
        self.assertEqual(resp.status_code, 400)
        MockClient.from_env.assert_not_called()

    @patch('backend.app.api.work_cards.WhatsAppListenerClient')
    def test_manual_card_without_image_is_rejected(self, MockClient):
        resp = self._send(self.manual_card_id, {'chat_id': GROUP_CHAT_ID})
        self.assertEqual(resp.status_code, 400)
        MockClient.from_env.assert_not_called()

    @patch('backend.app.api.work_cards.WhatsAppListenerClient')
    def test_other_business_card_is_not_found(self, MockClient):
        resp = self._send(uuid.uuid4(), {'chat_id': GROUP_CHAT_ID})
        self.assertEqual(resp.status_code, 404)

    @patch('backend.app.api.work_cards.WhatsAppListenerClient')
    def test_listener_not_configured_returns_503(self, MockClient):
        MockClient.from_env.return_value = None
        resp = self._send(self.card_id, {'chat_id': GROUP_CHAT_ID})
        self.assertEqual(resp.status_code, 503)

    @patch('backend.app.api.work_cards.WhatsAppListenerClient')
    def test_listener_not_connected_returns_503(self, MockClient):
        mock_client = MagicMock()
        mock_client.send_image.side_effect = WhatsAppNotConnectedError('offline')
        MockClient.from_env.return_value = mock_client
        resp = self._send(self.card_id, {'chat_id': GROUP_CHAT_ID})
        self.assertEqual(resp.status_code, 503)

    @patch('backend.app.api.work_cards.WhatsAppListenerClient')
    def test_payload_too_large_returns_413(self, MockClient):
        mock_client = MagicMock()
        mock_client.send_image.side_effect = WhatsAppPayloadTooLargeError('too big')
        MockClient.from_env.return_value = mock_client
        resp = self._send(self.card_id, {'chat_id': GROUP_CHAT_ID})
        self.assertEqual(resp.status_code, 413)


if __name__ == '__main__':
    unittest.main()
