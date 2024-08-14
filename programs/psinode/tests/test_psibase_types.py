#!/usr/bin/python

import unittest
from psibase import Action, Transaction
import fracpack

class TestPsibaseTypes(unittest.TestCase):
    def test_action_value(self):
        self.assertEqual(fracpack.pack(Action('alice', 'ink', 'foo', '0000')).hex().upper(), '1C000F316600000000002A49800000000000D3D500000000000004000000020000000000')
    def test_action(self):
        self.assertEqual(Action.packed({"sender":"alice", "service": "ink", "method": "foo", "rawData": "0000"}).hex().upper(), '1C000F316600000000002A49800000000000D3D500000000000004000000020000000000')
    def test_transaction(self):
        self.assertEqual(Transaction.packed({"tapos": {"expiration": 0, "refBlockSuffix":0, "refBlockIndex":0, "flags":0}, "actions":[{"sender":"alice", "service": "ink", "method": "foo", "rawData": "0000"}], "claims":[{"service":"verify-sig", "rawData": "02030405"}]}).hex().upper(), '13000000000000000000000000080000003000000004000000040000001C000F316600000000002A49800000000000D3D50000000000000400000002000000000004000000040000000C00EB9B61FB19780000040000000400000002030405')

if __name__ == '__main__':
    unittest.main()
