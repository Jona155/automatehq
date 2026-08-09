"""Report-only routing of manager-less sites (``sites.report_manager_id``).

A site with no ``field_manager_id`` produces employees nobody is asked to chase:
they land in the synthetic "ללא מנהל שטח" bucket, which the WhatsApp broadcast
skips. An admin can route such a site into a chosen manager's report; the routing
is report-only (it grants no scope elsewhere) and a real assignment always wins.

Requires a reachable local Postgres (same as the other DB-backed tests).
"""
import unittest
import uuid
from datetime import date

from dotenv import load_dotenv

load_dotenv()

from backend.app import create_app, db
from backend.app.api.missing_cards import _manager_rows
from backend.app.auth_utils import encode_auth_token
from backend.app.models.business import Business
from backend.app.models.sites import Site, Employee
from backend.app.models.users import User
from backend.app.models.work_cards import WorkCard
from backend.app.services import missing_cards_service as mcs

MONTH = date(2026, 6, 1)
MONTH_PARAM = '2026-06'
AFTER_MONTH_END = date(2026, 7, 2)


class MissingCardsReportRoutingTests(unittest.TestCase):
    def setUp(self):
        self.app = create_app()
        self.ctx = self.app.app_context()
        self.ctx.push()
        self.client = self.app.test_client()

        suffix = uuid.uuid4().hex[:8]
        self.business = Business(name=f'Biz {suffix}', code=f'biz{suffix}', is_active=True)
        db.session.add(self.business)
        db.session.flush()

        self.admin = User(business_id=self.business.id, full_name='Admin',
                          email=f'admin_{suffix}@ex.com', role='ADMIN')
        self.owner = User(business_id=self.business.id, full_name='Owning Mgr',
                          email=f'fm1_{suffix}@ex.com', role='FIELD_MANAGER')
        self.routed_to = User(business_id=self.business.id, full_name='Routed Mgr',
                              email=f'fm2_{suffix}@ex.com', role='FIELD_MANAGER')
        db.session.add_all([self.admin, self.owner, self.routed_to])
        db.session.flush()

        # owned: a real assignment. orphan: nobody owns it (the case under test).
        self.owned_site = Site(business_id=self.business.id, site_name=f'Owned {suffix}',
                               is_active=True, field_manager_id=self.owner.id)
        self.orphan_site = Site(business_id=self.business.id, site_name=f'Orphan {suffix}',
                                is_active=True)
        db.session.add_all([self.owned_site, self.orphan_site])
        db.session.flush()

        # No work cards anywhere -> every employee is a NONE gap.
        self.emp_owned = Employee(business_id=self.business.id, site_id=self.owned_site.id,
                                  full_name='Emp Owned', passport_id=f'PO{suffix}', is_active=True)
        self.emp_orphan = Employee(business_id=self.business.id, site_id=self.orphan_site.id,
                                   full_name='Emp Orphan', passport_id=f'PX{suffix}', is_active=True)
        db.session.add_all([self.emp_owned, self.emp_orphan])
        db.session.commit()

        self.admin_headers = {'Authorization': f'Bearer {encode_auth_token(str(self.admin.id))}'}
        self.routed_headers = {
            'Authorization': f'Bearer {encode_auth_token(str(self.routed_to.id))}'
        }

    def tearDown(self):
        try:
            biz_id = self.business.id
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

    # ---- helpers ----
    def _route_orphan_to(self, manager):
        self.orphan_site.report_manager_id = manager.id if manager else None
        db.session.commit()

    def _rows(self):
        return {
            r['employee_id']: r
            for r in mcs.compute_missing(self.business.id, MONTH, today=AFTER_MONTH_END)
        }

    # ---- service: effective manager resolution --------------------------
    def test_routed_orphan_reports_to_chosen_manager(self):
        self._route_orphan_to(self.routed_to)

        row = self._rows()[str(self.emp_orphan.id)]
        self.assertEqual(row['field_manager_id'], str(self.routed_to.id))
        self.assertEqual(row['manager_name'], 'Routed Mgr')
        self.assertTrue(row['is_report_routed'])

        groups = {g['field_manager_id']: g for g in
                  mcs.group_by_field_manager(list(self._rows().values()))}
        self.assertIn(str(self.routed_to.id), groups)
        self.assertEqual(
            [e['employee_id'] for e in groups[str(self.routed_to.id)]['employees']],
            [str(self.emp_orphan.id)],
        )
        # The synthetic manager-less bucket is now empty and therefore gone.
        self.assertNotIn(None, groups)

    def test_real_assignment_wins_over_routing(self):
        # A site that already has an owner ignores any routing left on it.
        self.owned_site.report_manager_id = self.routed_to.id
        db.session.commit()

        row = self._rows()[str(self.emp_owned.id)]
        self.assertEqual(row['field_manager_id'], str(self.owner.id))
        self.assertFalse(row['is_report_routed'])

    def test_unrouted_orphan_stays_in_the_managerless_bucket(self):
        row = self._rows()[str(self.emp_orphan.id)]
        self.assertIsNone(row['field_manager_id'])
        self.assertFalse(row['is_report_routed'])

        groups = {g['field_manager_id']: g for g in
                  mcs.group_by_field_manager(list(self._rows().values()))}
        self.assertIn(None, groups)
        self.assertEqual(groups[None]['manager_name'], mcs.NO_MANAGER_LABEL)

    def test_site_group_flags_the_routing(self):
        self._route_orphan_to(self.routed_to)
        by_site = {g['site_id']: g for g in mcs.group_by_site(list(self._rows().values()))}

        orphan = by_site[str(self.orphan_site.id)]
        self.assertTrue(orphan['is_report_routed'])
        self.assertEqual(orphan['manager_name'], 'Routed Mgr')
        self.assertFalse(by_site[str(self.owned_site.id)]['is_report_routed'])

    # ---- the manager's own report (Excel / WhatsApp payload) ------------
    def test_routed_employees_reach_the_managers_report(self):
        manager, rows = _manager_rows(self.business.id, MONTH, self.routed_to.id)
        self.assertEqual(rows, [])  # nothing routed yet -> broadcast would skip

        self._route_orphan_to(self.routed_to)
        manager, rows = _manager_rows(self.business.id, MONTH, self.routed_to.id)
        self.assertEqual(manager.id, self.routed_to.id)
        self.assertEqual([r['employee_id'] for r in rows], [str(self.emp_orphan.id)])

    # ---- HTTP: field-manager scoping -----------------------------------
    def test_field_manager_sees_the_site_routed_to_them(self):
        resp = self.client.get(
            f'/api/missing-cards?month={MONTH_PARAM}&group_by=site', headers=self.routed_headers
        )
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()['data']['groups'], [])

        self._route_orphan_to(self.routed_to)
        resp = self.client.get(
            f'/api/missing-cards?month={MONTH_PARAM}&group_by=site', headers=self.routed_headers
        )
        self.assertEqual(resp.status_code, 200)
        groups = resp.get_json()['data']['groups']
        self.assertEqual([g['site_id'] for g in groups], [str(self.orphan_site.id)])
        self.assertTrue(groups[0]['is_report_routed'])

    # ---- HTTP: setting the routing -------------------------------------
    def _put_routing(self, value, headers=None):
        return self.client.put(
            f'/api/sites/{self.orphan_site.id}',
            json={'report_manager_id': value},
            headers=headers or self.admin_headers,
        )

    def test_admin_can_set_and_clear_the_routing(self):
        resp = self._put_routing(str(self.routed_to.id))
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()['data']['report_manager_id'], str(self.routed_to.id))

        resp = self._put_routing(None)
        self.assertEqual(resp.status_code, 200)
        self.assertIsNone(resp.get_json()['data']['report_manager_id'])

    def test_routing_rejects_a_user_who_is_not_a_field_manager(self):
        resp = self._put_routing(str(self.admin.id))
        self.assertEqual(resp.status_code, 404)

        db.session.expire(self.orphan_site)
        self.assertIsNone(self.orphan_site.report_manager_id)

    def test_routing_rejects_a_malformed_id(self):
        self.assertEqual(self._put_routing('not-a-uuid').status_code, 400)

    def test_field_manager_may_not_set_the_routing(self):
        resp = self._put_routing(str(self.routed_to.id), headers=self.routed_headers)
        self.assertEqual(resp.status_code, 403)


if __name__ == '__main__':
    unittest.main()
