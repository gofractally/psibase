import copy
import unittest
from rejections import assert_rejected


class RejectionChecks(unittest.TestCase):
    def setUp(self):
        self.trace = {'error': 'expected error', 'actionTraces': [{
            'innerTraces': [{'inner': {'ActionTrace': {
                'action': {'service': 'favor', 'method': 'pay'},
                'error': 'expected error'}}}]}]}

    def test_expected_contract_action(self):
        assert_rejected(self.trace, 'expected error', 'favor', 'pay')

    def test_canonical_method_number(self):
        trace = copy.deepcopy(self.trace)
        trace['actionTraces'][0]['innerTraces'][0]['inner']['ActionTrace']['action']['method'] = 'setreceiving'
        assert_rejected(trace, 'expected error', 'favor', 'set_receiving')

    def test_cli_timeout_usage_and_missing_trace_cannot_pass(self):
        for trace in [None, {}, {'error': None}, {'error': 'CLI usage failure'},
                      {'error': 'expected error', 'actionTraces': []}]:
            with self.subTest(trace=trace), self.assertRaises(AssertionError):
                assert_rejected(trace, 'expected error', 'favor', 'pay')

    def test_unrelated_service_or_action_cannot_pass(self):
        for service, method in [('transact', 'pay'), ('favor', 'settle')]:
            with self.subTest(service=service, method=method), self.assertRaises(AssertionError):
                assert_rejected(self.trace, 'expected error', service, method)

    def test_successful_target_action_cannot_pass(self):
        trace = copy.deepcopy(self.trace)
        trace['actionTraces'][0]['innerTraces'][0]['inner']['ActionTrace']['error'] = None
        with self.assertRaises(AssertionError):
            assert_rejected(trace, 'expected error', 'favor', 'pay')


if __name__ == '__main__':
    unittest.main()
