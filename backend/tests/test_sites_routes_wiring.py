import os
import unittest

from backend.app import create_app


class SitesRouteWiringTests(unittest.TestCase):
    def test_sites_routes_registered(self):
        os.environ['DATABASE_URL'] = 'sqlite:///:memory:'
        app = create_app()
        rules = {rule.rule for rule in app.url_map.iter_rules()}

        expected = {
            '/api/sites',
            '/api/sites/<uuid:site_id>/matrix',
            '/api/sites/<uuid:site_id>/employee-upload-status',
            '/api/sites/<uuid:site_id>/summary/export',
            '/api/sites/summary/export-batch',
            '/api/sites/<uuid:site_id>/salary-template/export',
            '/api/sites/salary-template/export-batch',
            '/api/sites/<uuid:site_id>/access-link',
            '/api/sites/<uuid:site_id>/access-links',
            '/api/sites/access-links/whatsapp-batch',
            '/api/sites/<uuid:site_id>/access-link/<uuid:request_id>/revoke',
        }

        for route in expected:
            self.assertIn(route, rules)


if __name__ == '__main__':
    unittest.main()
