"""Pin the exact XLSX output of the Summary and Salary reports.

Golden files were generated from the report code before generation moved out
of ``api/sites.py``. A failure here means a download would differ from what
users receive today — do not regenerate the files unless that change is
intended. To regenerate deliberately: ``UPDATE_REPORT_GOLDEN=1 pytest <this file>``.
"""
import os
import unittest
from datetime import date

from openpyxl import load_workbook

from backend.app.services.sites import report_export as R
from backend.tests import report_golden_support as G

UPDATE = os.environ.get('UPDATE_REPORT_GOLDEN') == '1'
BATCH_MONTH = date(2026, 1, 1)


class ReportGoldenTests(unittest.TestCase):
    maxDiff = 2000

    def _check(self, name, snapshot):
        snapshot = G.normalise(snapshot)
        if UPDATE:
            G.write_golden(name, snapshot)
            return
        expected = G.read_golden(name)
        self.assertEqual(
            [s['title'] for s in snapshot['sheets']],
            [s['title'] for s in expected['sheets']],
        )
        for got, want in zip(snapshot['sheets'], expected['sheets']):
            cells_got, cells_want = got.pop('cells'), want.pop('cells')
            self.assertEqual(got, want, f'{name}: sheet layout differs')
            differing = sorted(
                key for key in set(cells_got) | set(cells_want)
                if cells_got.get(key) != cells_want.get(key)
            )
            self.assertEqual(
                differing, [],
                f"{name} / {got['title']}: cells differ, e.g. "
                + '; '.join(f'{k}: {cells_want.get(k)} -> {cells_got.get(k)}' for k in differing[:5]),
            )
        self.assertEqual(snapshot.get('filename'), expected.get('filename'))

    def test_summary_single_site(self):
        for name in G.SINGLE_CASES:
            with self.subTest(case=name):
                site, month, d = G.single_case(name)
                output, filename = R._generate_summary_xlsx(
                    site, d['employees'], d['matrix'], month, d['status_matrix'],
                    d['monthly_totals'], d['comment_matrix'], d['other_site_days'],
                )
                snapshot = G.snapshot_bytes(output.read())
                snapshot['filename'] = filename
                self._check(f'summary_single_{name}', snapshot)

    def test_salary_single_site(self):
        for name in G.SINGLE_CASES:
            with self.subTest(case=name):
                site, month, d = G.single_case(name)
                workbook = R.build_salary_workbook(
                    site, d['employees'], d['matrix'], month, d['status_matrix'], d['comment_matrix'],
                )
                self._check(f'salary_single_{name}', G.snapshot_workbook(workbook))

    def _summary_batch(self, sites, data, labels):
        workbook = load_workbook(R._resolve_summary_template_path())
        R.populate_summary_batch_workbook(workbook, sites, data, BATCH_MONTH, labels)
        return G.snapshot_workbook(workbook)

    def _salary_batch(self, sites, data):
        workbook = load_workbook(R._resolve_salary_template_path(BATCH_MONTH))
        R.populate_salary_batch_workbook(workbook, sites, data, BATCH_MONTH)
        return G.snapshot_workbook(workbook)

    def test_summary_batch(self):
        sites, data, labels = G.batch_case(BATCH_MONTH)
        self._check('summary_batch_generic', self._summary_batch(sites, data, {}))
        self._check('summary_batch_named', self._summary_batch(sites, data, labels))
        self._check('summary_batch_no_sites', self._summary_batch([], {}, {}))

    def test_salary_batch(self):
        sites, data, _ = G.batch_case(BATCH_MONTH)
        self._check('salary_batch', self._salary_batch(sites, data))
        self._check('salary_batch_no_sites', self._salary_batch([], {}))

    def test_batch_reports_employee_count(self):
        sites, data, _ = G.batch_case(BATCH_MONTH)
        workbook = load_workbook(R._resolve_summary_template_path())
        self.assertEqual(R.populate_summary_batch_workbook(workbook, sites, data, BATCH_MONTH), 12)
        workbook = load_workbook(R._resolve_salary_template_path(BATCH_MONTH))
        self.assertEqual(R.populate_salary_batch_workbook(workbook, sites, data, BATCH_MONTH), 12)


if __name__ == '__main__':
    unittest.main()
