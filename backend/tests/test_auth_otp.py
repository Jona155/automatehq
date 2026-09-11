import unittest
import uuid
from datetime import timedelta
from unittest.mock import patch

from dotenv import load_dotenv
from werkzeug.security import generate_password_hash

load_dotenv()

from backend.app import create_app, db
from backend.app.models.auth import AuthOtpChallenge
from backend.app.models.business import Business
from backend.app.models.users import User
from backend.app.services.auth_otp_service import _digest
from backend.app.services.auth_otp_service import cleanup_old_otp_challenges
from backend.app.services.auth_otp_service import OtpDeliveryFailed
from backend.app.utils import utc_now


class AuthOtpTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.ctx = self.app.app_context()
        self.ctx.push()
        self.client = self.app.test_client()

        suffix = uuid.uuid4().hex[:8]
        phone_suffix = f'{uuid.uuid4().int % 10_000_000:07d}'
        self.business = Business(name=f'Otp Biz {suffix}', code=f'otp{suffix}', is_active=True)
        db.session.add(self.business)
        db.session.flush()
        self.user = User(
            business_id=self.business.id,
            full_name='OTP User',
            email=f'otp-{suffix}@example.com',
            phone_number=f'050-{phone_suffix[:3]}-{phone_suffix[3:]}',
            role='ADMIN',
            password_hash=generate_password_hash('secret123', method='pbkdf2:sha256'),
            is_active=True,
        )
        db.session.add(self.user)
        db.session.commit()

    def tearDown(self):
        db.session.rollback()
        AuthOtpChallenge.query.filter_by(user_id=self.user.id).delete(synchronize_session=False)
        User.query.filter_by(id=self.user.id).delete(synchronize_session=False)
        Business.query.filter_by(id=self.business.id).delete(synchronize_session=False)
        db.session.commit()
        self.ctx.pop()

    @patch('backend.app.services.auth_otp_service._generate_code', return_value='123456')
    @patch('backend.app.services.auth_otp_service._send_code')
    def test_phone_otp_issues_normal_jwt_and_is_single_use(self, send_code, _generate_code):
        requested = self.client.post('/api/auth/otp/request', json={'phone_number': self.user.phone_number})
        self.assertEqual(requested.status_code, 202)
        challenge_id = requested.get_json()['data']['challenge_id']
        send_code.assert_called_once_with(self.user.phone_number, '123456')

        verified = self.client.post(
            '/api/auth/otp/verify',
            json={'challenge_id': challenge_id, 'code': '123456'},
        )
        self.assertEqual(verified.status_code, 200)
        self.assertIn('token', verified.get_json()['data'])
        self.assertEqual(verified.get_json()['data']['user']['id'], str(self.user.id))

        replay = self.client.post(
            '/api/auth/otp/verify',
            json={'challenge_id': challenge_id, 'code': '123456'},
        )
        self.assertEqual(replay.status_code, 410)

    @patch('backend.app.services.auth_otp_service._generate_code', return_value='123456')
    @patch('backend.app.services.auth_otp_service._send_code')
    def test_accepts_e164_equivalent_phone(self, send_code, _generate_code):
        local_digits = ''.join(character for character in self.user.phone_number if character.isdigit())
        e164 = f'+972{local_digits[1:]}'
        response = self.client.post('/api/auth/otp/request', json={'phone_number': e164})
        self.assertEqual(response.status_code, 202)
        self.assertNotEqual(response.get_json()['data']['masked_phone'], '***')
        send_code.assert_called_once()

    @patch('backend.app.services.auth_otp_service._generate_code', return_value='123456')
    @patch('backend.app.services.auth_otp_service._send_code')
    def test_wrong_code_increments_attempts(self, _send_code, _generate_code):
        requested = self.client.post('/api/auth/otp/request', json={'phone_number': self.user.phone_number})
        challenge_id = requested.get_json()['data']['challenge_id']
        response = self.client.post(
            '/api/auth/otp/verify',
            json={'challenge_id': challenge_id, 'code': '000000'},
        )
        self.assertEqual(response.status_code, 401)
        challenge = db.session.get(AuthOtpChallenge, uuid.UUID(challenge_id))
        self.assertEqual(challenge.failed_attempts, 1)

    @patch('backend.app.services.auth_otp_service._send_code')
    def test_expired_code_is_rejected(self, _send_code):
        challenge = AuthOtpChallenge(
            user_id=self.user.id,
            code_digest='pending',
            expires_at=utc_now() - timedelta(seconds=1),
            last_sent_at=utc_now() - timedelta(minutes=11),
        )
        db.session.add(challenge)
        db.session.flush()
        challenge.code_digest = _digest(challenge.id, '123456')
        db.session.commit()

        response = self.client.post(
            '/api/auth/otp/verify',
            json={'challenge_id': str(challenge.id), 'code': '123456'},
        )
        self.assertEqual(response.status_code, 410)

    def test_unknown_phone_returns_generic_challenge_without_jwt(self):
        response = self.client.post('/api/auth/otp/request', json={'phone_number': '0500000000'})
        self.assertEqual(response.status_code, 202)
        body = response.get_json()['data']
        self.assertIn('challenge_id', body)
        self.assertNotIn('token', body)
        self.assertTrue(body['masked_phone'].endswith('0000'))

    def test_delivery_failure_does_not_consume_hourly_allowance(self):
        with patch(
            'backend.app.services.auth_otp_service._send_code',
            side_effect=OtpDeliveryFailed('delivery failed'),
        ) as send_code:
            for _ in range(5):
                response = self.client.post(
                    '/api/auth/otp/request',
                    json={'phone_number': self.user.phone_number},
                )
                self.assertEqual(response.status_code, 503)

        self.assertEqual(send_code.call_count, 5)
        self.assertEqual(AuthOtpChallenge.query.filter_by(user_id=self.user.id).count(), 0)

        # A working provider must still be allowed after repeated delivery
        # failures; those failures are not successfully issued challenges.
        with patch('backend.app.services.auth_otp_service._send_code'):
            response = self.client.post(
                '/api/auth/otp/request',
                json={'phone_number': self.user.phone_number},
            )

        self.assertEqual(response.status_code, 202)
        self.assertEqual(AuthOtpChallenge.query.filter_by(user_id=self.user.id).count(), 1)

    def test_cleanup_deletes_only_challenges_past_retention(self):
        now = utc_now()
        old_challenge = AuthOtpChallenge(
            user_id=self.user.id,
            code_digest='old',
            expires_at=now - timedelta(days=8),
            last_sent_at=now - timedelta(days=8),
            created_at=now - timedelta(days=8),
        )
        recent_challenge = AuthOtpChallenge(
            user_id=self.user.id,
            code_digest='recent',
            expires_at=now - timedelta(days=6),
            last_sent_at=now - timedelta(days=6),
            created_at=now - timedelta(days=6),
        )
        db.session.add_all([old_challenge, recent_challenge])
        db.session.commit()
        old_challenge_id = old_challenge.id
        recent_challenge_id = recent_challenge.id

        deleted = cleanup_old_otp_challenges(now=now)

        self.assertEqual(deleted, 1)
        self.assertEqual(AuthOtpChallenge.query.filter_by(id=old_challenge_id).count(), 0)
        self.assertEqual(AuthOtpChallenge.query.filter_by(id=recent_challenge_id).count(), 1)

    def test_resend_replaces_the_previous_code(self):
        with patch('backend.app.services.auth_otp_service._generate_code', return_value='111111'), patch(
            'backend.app.services.auth_otp_service._send_code'
        ):
            requested = self.client.post('/api/auth/otp/request', json={'phone_number': self.user.phone_number})

        challenge_id = requested.get_json()['data']['challenge_id']
        challenge = db.session.get(AuthOtpChallenge, uuid.UUID(challenge_id))
        challenge.last_sent_at = utc_now() - timedelta(seconds=61)
        db.session.commit()

        with patch('backend.app.services.auth_otp_service._generate_code', return_value='222222'), patch(
            'backend.app.services.auth_otp_service._send_code'
        ):
            resent = self.client.post('/api/auth/otp/resend', json={'challenge_id': challenge_id})

        self.assertEqual(resent.status_code, 202)
        old_code = self.client.post(
            '/api/auth/otp/verify',
            json={'challenge_id': challenge_id, 'code': '111111'},
        )
        self.assertEqual(old_code.status_code, 401)
        new_code = self.client.post(
            '/api/auth/otp/verify',
            json={'challenge_id': challenge_id, 'code': '222222'},
        )
        self.assertEqual(new_code.status_code, 200)

    def test_password_login_still_issues_jwt_directly(self):
        response = self.client.post(
            '/api/auth/login',
            json={'email': self.user.email, 'password': 'secret123'},
        )
        self.assertEqual(response.status_code, 200)
        self.assertIn('token', response.get_json()['data'])


if __name__ == '__main__':
    unittest.main()
