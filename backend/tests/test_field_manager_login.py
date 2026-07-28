import unittest
import uuid

from dotenv import load_dotenv

load_dotenv()

from backend.app import create_app, db
from backend.app.auth_utils import encode_auth_token
from backend.app.models.business import Business
from backend.app.models.sites import Employee, Site
from backend.app.models.users import User
from backend.app.models.work_cards import WorkCard, WorkCardDayEntry


class FieldManagerLoginTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.ctx = self.app.app_context()
        self.ctx.push()
        self.client = self.app.test_client()

        self.suffix = uuid.uuid4().hex[:8]
        self.business = Business(name=f'Biz {self.suffix}', code=f'biz{self.suffix}', is_active=True)
        db.session.add(self.business)
        db.session.flush()

        self.admin = User(business_id=self.business.id, full_name='Admin',
                          email=f'admin_{self.suffix}@ex.com', role='ADMIN')
        db.session.add(self.admin)
        db.session.commit()

        self.admin_headers = {'Authorization': f'Bearer {encode_auth_token(str(self.admin.id))}'}

    def tearDown(self):
        try:
            biz_id = self.business.id
            card_ids = [c.id for c in WorkCard.query.filter_by(business_id=biz_id).all()]
            if card_ids:
                WorkCardDayEntry.query.filter(WorkCardDayEntry.work_card_id.in_(card_ids)).delete(synchronize_session=False)
            WorkCard.query.filter_by(business_id=biz_id).delete(synchronize_session=False)
            Employee.query.filter_by(business_id=biz_id).delete(synchronize_session=False)
            Site.query.filter_by(business_id=biz_id).delete(synchronize_session=False)
            User.query.filter_by(business_id=biz_id).delete(synchronize_session=False)
            Business.query.filter_by(id=biz_id).delete(synchronize_session=False)
            db.session.commit()
        except Exception:
            db.session.rollback()
        finally:
            self.ctx.pop()

    def _create_user(self, **payload):
        return self.client.post('/api/users', json=payload, headers=self.admin_headers)

    def _login(self, email, password):
        return self.client.post('/api/auth/login', json={'email': email, 'password': password})

    # ---- create + login -------------------------------------------------
    def test_field_manager_with_credentials_can_login(self):
        email = f'fm1_{self.suffix}@ex.com'
        resp = self._create_user(full_name='FM One', role='FIELD_MANAGER',
                                 email=email, password='secret123', phone_number=f'050{self.suffix[:7]}')
        self.assertEqual(resp.status_code, 201)

        login = self._login(email, 'secret123')
        self.assertEqual(login.status_code, 200)
        body = login.get_json()['data']
        self.assertIn('token', body)
        self.assertEqual(body['user']['role'], 'FIELD_MANAGER')
        self.assertEqual(body['user']['business_id'], str(self.business.id))

    def test_login_only_field_manager_without_phone(self):
        # Relaxation: an FM with email+password but no phone is allowed.
        email = f'fm2_{self.suffix}@ex.com'
        resp = self._create_user(full_name='FM Two', role='FIELD_MANAGER',
                                 email=email, password='secret123')
        self.assertEqual(resp.status_code, 201)
        self.assertEqual(self._login(email, 'secret123').status_code, 200)

    def test_phone_only_field_manager_still_valid_but_cannot_login(self):
        resp = self._create_user(full_name='FM Phone', role='FIELD_MANAGER',
                                 phone_number=f'051{self.suffix[:7]}')
        self.assertEqual(resp.status_code, 201)
        # No email/password -> cannot authenticate (login is email-based; the
        # phone is not a login key), so it resolves to invalid credentials.
        self.assertEqual(self._login(f'051{self.suffix[:7]}', 'anything').status_code, 401)

    def test_create_password_without_email_rejected(self):
        resp = self._create_user(full_name='FM Bad', role='FIELD_MANAGER',
                                 password='secret123', phone_number=f'052{self.suffix[:7]}')
        self.assertEqual(resp.status_code, 400)

    # ---- update path (the gap fix) -------------------------------------
    def test_admin_sets_password_on_existing_field_manager_via_update(self):
        # Start phone-only, then grant login credentials via edit.
        create = self._create_user(full_name='FM Later', role='FIELD_MANAGER',
                                   phone_number=f'053{self.suffix[:7]}')
        self.assertEqual(create.status_code, 201)
        user_id = create.get_json()['data']['id']

        email = f'fm3_{self.suffix}@ex.com'
        upd = self.client.put(f'/api/users/{user_id}',
                              json={'email': email, 'password': 'newpass123'},
                              headers=self.admin_headers)
        self.assertEqual(upd.status_code, 200)
        self.assertEqual(self._login(email, 'newpass123').status_code, 200)

    def test_update_password_without_email_rejected(self):
        create = self._create_user(full_name='FM NoEmail', role='FIELD_MANAGER',
                                   phone_number=f'054{self.suffix[:7]}')
        user_id = create.get_json()['data']['id']
        upd = self.client.put(f'/api/users/{user_id}',
                              json={'password': 'newpass123'},
                              headers=self.admin_headers)
        self.assertEqual(upd.status_code, 400)


if __name__ == '__main__':
    unittest.main()
