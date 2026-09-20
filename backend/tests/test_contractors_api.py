import unittest
import uuid

from dotenv import load_dotenv

load_dotenv()

from backend.app import create_app, db
from backend.app.auth_utils import encode_auth_token
from backend.app.models.business import Business
from backend.app.models.contractors import Contractor
from backend.app.models.sites import Employee, Site
from backend.app.models.users import User
from backend.app.repositories.business_repository import BusinessRepository


class ContractorsApiTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.client = self.app.test_client()
        self.ctx = self.app.app_context()
        self.ctx.push()

        suffix = uuid.uuid4().hex[:8]
        self.business = Business(name=f'Contractors {suffix}', code=f'contractors-{suffix}')
        self.other_business = Business(name=f'Other {suffix}', code=f'other-contractors-{suffix}')
        db.session.add_all([self.business, self.other_business])
        db.session.flush()

        self.admin = User(
            business_id=self.business.id,
            full_name='Admin',
            email=f'contractor-admin-{suffix}@example.com',
            role='ADMIN',
            password_hash='n/a',
            is_active=True,
        )
        self.operator = User(
            business_id=self.business.id,
            full_name='Operator',
            email=f'contractor-operator-{suffix}@example.com',
            role='OPERATOR_MANAGER',
            password_hash='n/a',
            is_active=True,
        )
        self.other_admin = User(
            business_id=self.other_business.id,
            full_name='Other Admin',
            email=f'contractor-other-{suffix}@example.com',
            role='ADMIN',
            password_hash='n/a',
            is_active=True,
        )
        self.site_a = Site(business_id=self.business.id, site_name=f'Alpha {suffix}')
        self.site_b = Site(business_id=self.business.id, site_name=f'Beta {suffix}')
        self.foreign_site = Site(business_id=self.other_business.id, site_name=f'Foreign {suffix}')
        db.session.add_all([
            self.admin,
            self.operator,
            self.other_admin,
            self.site_a,
            self.site_b,
            self.foreign_site,
        ])
        db.session.commit()

        self.business_id = self.business.id
        self.other_business_id = self.other_business.id
        self.admin_headers = {
            'Authorization': f'Bearer {encode_auth_token(str(self.admin.id))}'
        }
        self.operator_headers = {
            'Authorization': f'Bearer {encode_auth_token(str(self.operator.id))}'
        }
        self.other_headers = {
            'Authorization': f'Bearer {encode_auth_token(str(self.other_admin.id))}'
        }

    def tearDown(self):
        try:
            BusinessRepository().hard_delete(self.business_id)
            BusinessRepository().hard_delete(self.other_business_id)
        except Exception:
            db.session.rollback()
        self.ctx.pop()

    def _create(self, name='Acme', site_ids=None, **extra):
        payload = {'name': name, **extra}
        if site_ids is not None:
            payload['site_ids'] = site_ids
        return self.client.post('/api/contractors', json=payload, headers=self.admin_headers)

    def test_crud_normalizes_optional_fields_and_assigns_sites(self):
        db.session.add_all([
            Employee(
                business_id=self.business.id,
                site_id=self.site_a.id,
                full_name='Active employee',
                passport_id=f'active-{uuid.uuid4().hex}',
                is_active=True,
            ),
            Employee(
                business_id=self.business.id,
                site_id=self.site_a.id,
                full_name='Inactive employee',
                passport_id=f'inactive-{uuid.uuid4().hex}',
                is_active=False,
            ),
        ])
        db.session.commit()
        response = self._create(
            name='  Acme Staffing  ',
            site_ids=[str(self.site_a.id)],
            email='  OFFICE@EXAMPLE.COM ',
            phone_number='050-123-4567',
            address='  Main Street 1  ',
        )
        self.assertEqual(response.status_code, 201)
        data = response.get_json()['data']
        self.assertEqual(data['name'], 'Acme Staffing')
        self.assertEqual(data['email'], 'office@example.com')
        self.assertEqual(data['phone_number'], '972501234567')
        self.assertEqual(data['address'], 'Main Street 1')
        self.assertEqual(data['site_count'], 1)
        self.assertEqual(data['employee_count'], 1)
        self.assertEqual(data['sites'][0]['id'], str(self.site_a.id))

        listed = self.client.get('/api/contractors', headers=self.admin_headers)
        self.assertEqual(listed.status_code, 200)
        self.assertEqual(listed.get_json()['data'][0]['employee_count'], 1)

        response = self.client.put(
            f"/api/contractors/{data['id']}",
            json={'email': '', 'phone_number': '', 'address': '', 'site_ids': []},
            headers=self.admin_headers,
        )
        self.assertEqual(response.status_code, 200)
        updated = response.get_json()['data']
        self.assertIsNone(updated['email'])
        self.assertIsNone(updated['phone_number'])
        self.assertIsNone(updated['address'])
        self.assertEqual(updated['sites'], [])
        self.assertEqual(updated['employee_count'], 0)

    def test_duplicate_name_is_case_insensitive_within_business(self):
        self.assertEqual(self._create(name='Acme').status_code, 201)
        duplicate = self._create(name='acme')
        self.assertEqual(duplicate.status_code, 409)

        other_response = self.client.post(
            '/api/contractors',
            json={'name': 'ACME'},
            headers=self.other_headers,
        )
        self.assertEqual(other_response.status_code, 201)

    def test_read_is_tenant_scoped_and_operator_cannot_write(self):
        own = self._create(name='Own Contractor').get_json()['data']
        foreign = self.client.post(
            '/api/contractors',
            json={'name': 'Foreign Contractor'},
            headers=self.other_headers,
        ).get_json()['data']

        listed = self.client.get('/api/contractors', headers=self.operator_headers)
        self.assertEqual(listed.status_code, 200)
        self.assertEqual([item['id'] for item in listed.get_json()['data']], [own['id']])
        self.assertEqual(
            self.client.get(f"/api/contractors/{foreign['id']}", headers=self.admin_headers).status_code,
            404,
        )
        self.assertEqual(
            self.client.post(
                '/api/contractors',
                json={'name': 'Forbidden'},
                headers=self.operator_headers,
            ).status_code,
            403,
        )

    def test_cross_tenant_site_assignment_is_rejected(self):
        response = self._create(name='Bad Assignment', site_ids=[str(self.foreign_site.id)])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(Contractor.query.filter_by(name='Bad Assignment').count(), 0)

    def test_site_api_cannot_bypass_assignment_rules(self):
        contractor = self._create(name='Protected Assignment').get_json()['data']
        response = self.client.put(
            f'/api/sites/{self.site_a.id}',
            json={'contractor_id': contractor['id']},
            headers=self.admin_headers,
        )
        self.assertEqual(response.status_code, 400)
        db.session.refresh(self.site_a)
        self.assertIsNone(self.site_a.contractor_id)

    def test_sites_list_includes_assigned_contractor_name(self):
        self._create(name='Visible Contractor', site_ids=[str(self.site_a.id)])

        response = self.client.get(
            '/api/sites?include_counts=true',
            headers=self.operator_headers,
        )

        self.assertEqual(response.status_code, 200)
        sites_by_id = {site['id']: site for site in response.get_json()['data']}
        self.assertEqual(
            sites_by_id[str(self.site_a.id)]['contractor_name'],
            'Visible Contractor',
        )
        self.assertIsNone(sites_by_id[str(self.site_b.id)]['contractor_name'])

        detail_response = self.client.get(
            f'/api/sites/{self.site_a.id}',
            headers=self.operator_headers,
        )
        self.assertEqual(detail_response.status_code, 200)
        self.assertEqual(
            detail_response.get_json()['data']['contractor_name'],
            'Visible Contractor',
        )

    def test_reassignment_requires_confirmation(self):
        first = self._create(name='First', site_ids=[str(self.site_a.id)]).get_json()['data']
        second = self._create(name='Second').get_json()['data']

        response = self.client.put(
            f"/api/contractors/{second['id']}",
            json={'site_ids': [str(self.site_a.id)]},
            headers=self.admin_headers,
        )
        self.assertEqual(response.status_code, 409)
        conflicts = response.get_json()['data']['conflicts']
        self.assertEqual(conflicts[0]['contractor_id'], first['id'])

        confirmed = self.client.put(
            f"/api/contractors/{second['id']}",
            json={
                'site_ids': [str(self.site_a.id)],
                'confirm_reassignment': True,
            },
            headers=self.admin_headers,
        )
        self.assertEqual(confirmed.status_code, 200)
        db.session.refresh(self.site_a)
        self.assertEqual(str(self.site_a.contractor_id), second['id'])

    def test_omitted_site_ids_preserves_assignments_and_empty_list_clears(self):
        contractor = self._create(
            name='Assignment Owner',
            site_ids=[str(self.site_a.id), str(self.site_b.id)],
        ).get_json()['data']
        response = self.client.put(
            f"/api/contractors/{contractor['id']}",
            json={'address': 'Updated'},
            headers=self.admin_headers,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['data']['site_count'], 2)

        response = self.client.put(
            f"/api/contractors/{contractor['id']}",
            json={'site_ids': []},
            headers=self.admin_headers,
        )
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.get_json()['data']['site_count'], 0)

    def test_deactivation_requires_no_sites_and_inactive_cannot_receive_sites(self):
        contractor = self._create(
            name='Lifecycle',
            site_ids=[str(self.site_a.id)],
        ).get_json()['data']
        url = f"/api/contractors/{contractor['id']}"
        self.assertEqual(self.client.delete(url, headers=self.admin_headers).status_code, 409)

        self.assertEqual(
            self.client.put(url, json={'site_ids': []}, headers=self.admin_headers).status_code,
            200,
        )
        deactivated = self.client.delete(url, headers=self.admin_headers)
        self.assertEqual(deactivated.status_code, 200)
        self.assertFalse(deactivated.get_json()['data']['is_active'])

        assign_inactive = self.client.put(
            url,
            json={'site_ids': [str(self.site_b.id)]},
            headers=self.admin_headers,
        )
        self.assertEqual(assign_inactive.status_code, 400)
        reactivated = self.client.put(
            url,
            json={'is_active': True, 'site_ids': [str(self.site_b.id)]},
            headers=self.admin_headers,
        )
        self.assertEqual(reactivated.status_code, 200)
        self.assertTrue(reactivated.get_json()['data']['is_active'])


if __name__ == '__main__':
    unittest.main()
