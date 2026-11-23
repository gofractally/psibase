#!/usr/bin/python

import unittest
from psibase import Action, Transaction
import fracpack

# Keep packing-layout expectations independent from the active statistical model.
# Retuning only regenerates model artifacts; no fixture ID is hand-edited here.
def expected_action_hex():
    import name
    method = name.method_to_number("foo").to_bytes(8, "little").hex().upper()
    return "1C0000B82A1B83AEDF04003019CAC1149308" + method + "04000000020000000000"

class TestPsibaseTypes(unittest.TestCase):
    def test_action_value(self):
        self.assertEqual(fracpack.pack(Action('alice', 'ink', 'foo', '0000')).hex().upper(), expected_action_hex())

    def test_action(self):
        self.assertEqual(Action.packed({"sender":"alice", "service":"ink", "method":"foo", "rawData":"0000"}).hex().upper(), expected_action_hex())

    def test_transaction(self):
        transaction = {"tapos": {"expiration":0, "refBlockSuffix":0, "refBlockIndex":0, "flags":0},
                       "actions":[{"sender":"alice", "service":"ink", "method":"foo", "rawData":"0000"}],
                       "claims":[{"service":"verify-sig", "rawData":"02030405"}]}
        prefix = "170000000000000000000000000000000008000000300000000400000004000000"
        suffix = "04000000040000000C00004A3347810E700E040000000400000002030405"
        self.assertEqual(Transaction.packed(transaction).hex().upper(), prefix + expected_action_hex() + suffix)

if __name__ == '__main__':
    unittest.main()
