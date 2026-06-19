import unittest
from datetime import date

from backend.app.services import missing_cards_service as mcs


def _row(emp, status, *, site_id='S1', site_name='Site 1', fm='M1', fm_name='Manager 1',
         fm_phone='0501234567', cards=0, expected=2, first=None):
    return {
        'employee_id': emp,
        'full_name': emp,
        'passport_id': f'P-{emp}',
        'phone_number': '0500000000',
        'site_id': site_id,
        'site_name': site_name,
        'field_manager_id': fm,
        'manager_name': fm_name,
        'manager_phone': fm_phone,
        'cards_count': cards,
        'expected': expected,
        'status': status,
        'first_uploaded_at': first,
    }


class ClassifyTests(unittest.TestCase):
    def test_none_partial_complete(self):
        self.assertEqual(mcs._classify(0, 2), mcs.STATUS_NONE)
        self.assertEqual(mcs._classify(1, 2), mcs.STATUS_PARTIAL)
        self.assertEqual(mcs._classify(2, 2), mcs.STATUS_COMPLETE)
        self.assertEqual(mcs._classify(3, 2), mcs.STATUS_COMPLETE)

    def test_expected_one_means_single_card_completes(self):
        self.assertEqual(mcs._classify(1, 1), mcs.STATUS_COMPLETE)
        self.assertEqual(mcs._classify(0, 1), mcs.STATUS_NONE)


class EffectiveThresholdTests(unittest.TestCase):
    MONTH = date(2026, 6, 1)

    def test_within_open_month_requires_only_one_card(self):
        # Any day on/before the last day of the reporting month -> threshold 1,
        # so an employee with a single card is NOT a gap.
        for today in (date(2026, 6, 1), date(2026, 6, 15), date(2026, 6, 30)):
            self.assertEqual(mcs.effective_threshold(self.MONTH, 2, today), 1, today)
            self.assertEqual(mcs._classify(1, mcs.effective_threshold(self.MONTH, 2, today)),
                             mcs.STATUS_COMPLETE, today)

    def test_after_month_ends_requires_full_expected(self):
        # From the 1st of the following month onward -> full expected, so an
        # employee with only the first card is flagged as PARTIAL.
        for today in (date(2026, 7, 1), date(2026, 7, 10), date(2026, 7, 25)):
            self.assertEqual(mcs.effective_threshold(self.MONTH, 2, today), 2, today)
            self.assertEqual(mcs._classify(1, mcs.effective_threshold(self.MONTH, 2, today)),
                             mcs.STATUS_PARTIAL, today)

    def test_zero_cards_always_missing(self):
        within = mcs._classify(0, mcs.effective_threshold(self.MONTH, 2, date(2026, 6, 10)))
        after = mcs._classify(0, mcs.effective_threshold(self.MONTH, 2, date(2026, 7, 5)))
        self.assertEqual(within, mcs.STATUS_NONE)
        self.assertEqual(after, mcs.STATUS_NONE)


class GroupByFieldManagerTests(unittest.TestCase):
    def test_only_gaps_included_and_complete_excluded(self):
        rows = [
            _row('a', mcs.STATUS_NONE),
            _row('b', mcs.STATUS_PARTIAL, cards=1),
            _row('c', mcs.STATUS_COMPLETE, cards=2),
        ]
        groups = mcs.group_by_field_manager(rows)
        self.assertEqual(len(groups), 1)
        g = groups[0]
        self.assertEqual(g['missing_count'], 2)
        self.assertEqual(g['none_count'], 1)
        self.assertEqual(g['partial_count'], 1)
        # Coverage counts span all employees; the list shows only gaps.
        self.assertEqual(g['total_employees'], 3)
        self.assertEqual(g['complete_count'], 1)
        self.assertEqual({e['employee_id'] for e in g['employees']}, {'a', 'b'})

    def test_manager_with_no_gaps_is_omitted(self):
        rows = [
            _row('a', mcs.STATUS_NONE, fm='M1', fm_name='Has Gap'),
            _row('b', mcs.STATUS_COMPLETE, cards=2, fm='M2', fm_name='All Done'),
        ]
        groups = mcs.group_by_field_manager(rows)
        self.assertEqual([g['field_manager_id'] for g in groups], ['M1'])

    def test_managerless_bucket_last(self):
        rows = [
            _row('a', mcs.STATUS_NONE, fm='M1', fm_name='Alpha'),
            _row('x', mcs.STATUS_NONE, fm=None, fm_name=None, fm_phone=None),
        ]
        groups = mcs.group_by_field_manager(rows)
        self.assertEqual(len(groups), 2)
        self.assertIsNone(groups[-1]['field_manager_id'])
        self.assertEqual(groups[-1]['manager_name'], mcs.NO_MANAGER_LABEL)


class GroupBySiteTests(unittest.TestCase):
    def test_zero_coverage_site_appears(self):
        # A site where every employee has 0 cards must still appear with
        # complete=0 and the full headcount as missing.
        rows = [
            _row('a', mcs.STATUS_NONE, site_id='ZERO', site_name='Empty Site', cards=0),
            _row('b', mcs.STATUS_NONE, site_id='ZERO', site_name='Empty Site', cards=0),
        ]
        groups = mcs.group_by_site(rows)
        self.assertEqual(len(groups), 1)
        g = groups[0]
        self.assertEqual(g['site_id'], 'ZERO')
        self.assertEqual(g['total_employees'], 2)
        self.assertEqual(g['complete_count'], 0)
        self.assertEqual(g['missing_count'], 2)

    def test_coverage_counts_all_employees_but_lists_only_gaps(self):
        rows = [
            _row('a', mcs.STATUS_COMPLETE, site_id='S', cards=2),
            _row('b', mcs.STATUS_PARTIAL, site_id='S', cards=1),
        ]
        groups = mcs.group_by_site(rows)
        g = groups[0]
        self.assertEqual(g['total_employees'], 2)
        self.assertEqual(g['complete_count'], 1)
        self.assertEqual(g['missing_count'], 1)
        self.assertEqual([e['employee_id'] for e in g['employees']], ['b'])

    def test_sites_sorted_by_missing_desc(self):
        rows = [
            _row('a', mcs.STATUS_COMPLETE, site_id='LOW', site_name='Low', cards=2),
            _row('b', mcs.STATUS_NONE, site_id='HIGH', site_name='High'),
            _row('c', mcs.STATUS_NONE, site_id='HIGH', site_name='High'),
        ]
        groups = mcs.group_by_site(rows)
        self.assertEqual(groups[0]['site_id'], 'HIGH')


class PhoneNormalizationTests(unittest.TestCase):
    def test_israeli_local(self):
        self.assertEqual(mcs.normalize_phone_to_whatsapp('050-123-4567'), '972501234567@s.whatsapp.net')

    def test_plus_prefixed(self):
        self.assertEqual(mcs.normalize_phone_to_whatsapp('+972501234567'), '972501234567@s.whatsapp.net')

    def test_blank_and_invalid(self):
        self.assertIsNone(mcs.normalize_phone_to_whatsapp(''))
        self.assertIsNone(mcs.normalize_phone_to_whatsapp(None))
        self.assertIsNone(mcs.normalize_phone_to_whatsapp('abc'))


class XlsxGenerationTests(unittest.TestCase):
    def test_generates_nonempty_workbook(self):
        rows = [
            _row('a', mcs.STATUS_NONE),
            _row('b', mcs.STATUS_PARTIAL, cards=1, first='2026-06-05T08:00:00+00:00'),
        ]
        output = mcs.generate_missing_cards_xlsx('Manager 1', rows, date(2026, 6, 1))
        data = output.read()
        self.assertTrue(len(data) > 0)
        self.assertEqual(data[:2], b'PK')  # xlsx is a zip


if __name__ == '__main__':
    unittest.main()
