"""The preview model must describe exactly the workbook the download contains."""
import json
import unittest

from backend.app.services.sites import report_export as R
from backend.app.services.sites import report_model as M
from backend.tests import report_golden_support as G


def _by_position(model):
    return {(c['row'], c['col']): c for c in model['cells']}


class ReportModelParityTests(unittest.TestCase):
    """Every populated workbook cell appears in the model with the same value,
    note and fill — for every golden fixture."""

    def _assert_parity(self, ws, model):
        cells = _by_position(model)
        for row in range(1, model['row_count'] + 1):
            for col in range(1, ws.max_column + 1):
                cell = ws.cell(row=row, column=col)
                raw = None if cell.value == '' else cell.value
                entry = cells.get((row, col))
                if raw is None and cell.comment is None:
                    continue
                self.assertIsNotNone(entry, f'{cell.coordinate} missing from model')
                if isinstance(raw, str) and raw.startswith('='):
                    self.assertEqual(entry['formula'], raw)
                    self.assertEqual(entry['kind'], 'calculated')
                else:
                    self.assertEqual(entry['value'], raw, cell.coordinate)
                self.assertEqual(entry.get('note'), cell.comment.text if cell.comment else None)

    def test_summary_matches_workbook(self):
        for name in G.SINGLE_CASES:
            with self.subTest(case=name):
                site, month, d = G.single_case(name)
                workbook = R.build_summary_workbook(
                    site, d['employees'], d['matrix'], month, d['status_matrix'],
                    d['monthly_totals'], d['comment_matrix'], d['other_site_days'],
                )
                model = M.build_summary_report_model(site, d, month)
                self._assert_parity(workbook.worksheets[0], model)
                self.assertEqual(model['sheet_title'], workbook.worksheets[0].title)
                json.dumps(model)  # must be JSON-serializable

    def test_salary_matches_workbook(self):
        for name in G.SINGLE_CASES:
            with self.subTest(case=name):
                site, month, d = G.single_case(name)
                workbook = R.build_salary_workbook(
                    site, d['employees'], d['matrix'], month, d['status_matrix'], d['comment_matrix'],
                )
                model = M.build_salary_report_model(site, d, month)
                self._assert_parity(workbook.worksheets[0], model)
                json.dumps(model)


class SummaryModelTests(unittest.TestCase):
    def setUp(self):
        self.site, self.month, self.data = G.single_case('feb_3emp_tariff')
        self.model = M.build_summary_report_model(self.site, self.data, self.month)
        self.cells = _by_position(self.model)
        self.employees = self.data['employees']

    def test_day_cells_are_inputs_keyed_by_employee_and_day(self):
        inputs = [c for c in self.model['cells'] if c['kind'] == 'input']
        self.assertEqual(len(inputs), 3 * 28)
        for idx, employee in enumerate(self.employees):
            for day in (1, 14, 28):
                cell = self.cells[(day + 2, idx + 2)]
                self.assertEqual((cell['employee_id'], cell['day']), (str(employee.id), day))

    def test_only_day_cells_are_inputs(self):
        for cell in self.model['cells']:
            in_day_grid = 3 <= cell['row'] <= 30 and 2 <= cell['col'] <= 4
            self.assertEqual(cell['kind'] == 'input', in_day_grid, cell)

    def test_total_is_calculated_from_numeric_day_cells(self):
        employee = self.employees[0]
        expected = round(sum(self.data['matrix'][str(employee.id)].values()), 2)
        total = self.cells[(self.model['total_row'], 2)]
        self.assertEqual(total['kind'], 'calculated')
        self.assertEqual(total['value'], expected)

    def test_monthly_override_is_a_protected_literal(self):
        override_employee = self.employees[2]
        self.assertIn(str(override_employee.id), self.model['monthly_total_overrides'])
        total = self.cells[(self.model['total_row'], 4)]
        self.assertEqual(total['kind'], 'protected')
        self.assertEqual(total['value'], 187.5)

    def test_tariff_block_is_calculated(self):
        total_row = self.model['total_row']
        value_col = len(self.employees) + 2
        totals = [self.cells[(total_row, col)]['value'] for col in range(2, value_col)]
        grand = self.cells[(total_row, value_col)]
        self.assertEqual(grand['value'], round(sum(totals), 2))
        self.assertEqual(self.cells[(total_row + 2, value_col)]['value'], 78.5)
        no_vat = self.cells[(total_row + 3, value_col)]
        self.assertEqual(no_vat['value'], round(grand['value'] * 78.5, 2))
        with_vat = self.cells[(total_row + 4, value_col)]
        self.assertEqual(with_vat['value'], round(no_vat['value'] * 1.18, 2))
        for cell in (grand, no_vat, with_vat):
            self.assertEqual(cell['kind'], 'calculated')

    def test_other_site_marker_never_names_a_site(self):
        blob = json.dumps(self.model, ensure_ascii=False)
        self.assertIn(R.OTHER_SITE_LABEL, blob)
        self.assertNotIn(R.OTHER_SITE_NAMED_PREFIX, blob)
        self.assertNotIn('other_site_ids', self.model)

    def test_no_tariff_means_no_tariff_cells(self):
        site, month, data = G.single_case('apr_4emp_no_tariff')
        model = M.build_summary_report_model(site, data, month)
        below_total = [c for c in model['cells'] if c['row'] > model['total_row'] and c.get('value') is not None]
        self.assertEqual(below_total, [])


class SalaryModelTests(unittest.TestCase):
    def setUp(self):
        self.site, self.month, self.data = G.single_case('jan_9emp_tariff')
        self.model = M.build_salary_report_model(self.site, self.data, self.month)
        self.cells = _by_position(self.model)

    def test_day_cells_are_inputs_for_31_days(self):
        inputs = [c for c in self.model['cells'] if c['kind'] == 'input']
        self.assertEqual(len(inputs), 9 * 31)
        first = self.data['employees'][0]
        cell = self.cells[(2, 2)]
        self.assertEqual((cell['employee_id'], cell['day']), (str(first.id), 1))

    def test_passport_column_and_instructions_are_protected(self):
        self.assertEqual(self.cells[(2, 1)]['kind'], 'protected')
        self.assertEqual(self.cells[(2, 1)]['value'], 'P00001')
        instruction = self.cells[(self.model['instruction_row'], 1)]
        self.assertEqual(instruction['kind'], 'protected')

    def test_rows_without_an_employee_have_no_inputs(self):
        for cell in self.model['cells']:
            if cell['row'] > 1 + 9:
                self.assertNotEqual(cell['kind'], 'input', cell)


class FormulaEvaluatorTests(unittest.TestCase):
    def test_unknown_formula_evaluates_to_none(self):
        from openpyxl import Workbook
        ws = Workbook().active
        ws['A1'] = 2
        ws['A2'] = '=A1+1'
        ws['A3'] = '=SUM(A1:A2)'
        evaluator = M._FormulaEvaluator(ws)
        self.assertIsNone(evaluator.cell_value('A2'))
        self.assertEqual(evaluator.cell_value('A3'), 2.0)

    def test_circular_reference_does_not_loop(self):
        from openpyxl import Workbook
        ws = Workbook().active
        ws['A1'] = '=SUM(A2)'
        ws['A2'] = '=SUM(A1)'
        self.assertEqual(M._FormulaEvaluator(ws).cell_value('A1'), 0.0)

    def test_unknown_report_type_is_rejected(self):
        with self.assertRaises(ValueError):
            M.build_report_model('other', None, {}, None)


if __name__ == '__main__':
    unittest.main()
