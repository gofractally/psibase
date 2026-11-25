#!/usr/bin/python

import hashlib
import json
import pathlib
import unittest
import psio
from psibase import Action, Claim, ServiceSchema, SignedTransaction, Transaction

class TestPsibaseTypes(unittest.TestCase):
    def test_action(self):
        packed = '1C00000000B82A1B83AEDF04003019CAC1149308D3D50000000000001C0000000000'
        self.assertEqual(psio.to_pssz(Action('alice', 'ink', 'foo', '0000')).hex().upper(), packed)
        self.assertEqual(psio.to_pssz(Action('alice', 'ink', 'foo', rawData=b'\0\0')).hex().upper(), packed)
        self.assertEqual(psio.to_ijson(psio.from_pssz(Action, bytes.fromhex(packed))),
                         '{"sender":"alice","service":"ink","method":"foo","rawData":"0000"}')
    def test_transaction(self):
        tapos = {"expiration": "1970-01-01T00:00:00Z", "refBlockSuffix": 0, "refBlockIndex": 0, "flags": 0}
        trx = Transaction(tapos, [Action('alice', 'ink', 'foo', '0000')], [{"service": "verify-sig", "rawData": "02030405"}])
        self.assertEqual(psio.to_pssz(trx).hex().upper(),
                         '17000000000000000000000000000000000000170000003D00000004000000'
                         '1C00000000B82A1B83AEDF04003019CAC1149308D3D50000000000001C0000000000'
                         '040000000C000000004A3347810E700E0C00000002030405')
        self.assertEqual(trx.claims, [Claim('verify-sig', bytes.fromhex('02030405'))])
    def test_cpp_transactions(self):
        '''The transactions of the C++ fixture: their bytes, their id and their text are read and written alike'''
        fixture = pathlib.Path(__file__).parent / '../../../libraries/psibase/common/tests/rust-twins.json'
        with open(fixture) as f:
            transactions = json.load(f)['transactions']
        self.assertGreater(len(transactions), 0)
        for expected in transactions:
            with self.subTest(expected['name']):
                packed = bytes.fromhex(expected['signed'])
                signed = psio.from_pssz(SignedTransaction, packed)
                self.assertEqual(psio.to_pssz(signed), packed)
                self.assertEqual(hashlib.sha256(signed.transaction).hexdigest(), expected['id'])
                trx = psio.from_pssz(Transaction, signed.transaction)
                self.assertEqual(psio.to_pssz(trx), signed.transaction)
                self.assertEqual(json.loads(psio.to_ijson(trx)), json.loads(expected['ijson'])['transaction'])
    def test_action_arguments(self):
        '''Arguments are packed with the schema of the service: by name, by position, names as text'''
        document = {
            "service": "svc",
            "types": {"package": {"name": "", "version": "", "attributes": []}, "interfaces": [], "worlds": [], "uses": [],
                      "types": [
                          {"name": "@0", "type": {"value": {"Object": {"members": [
                              {"name": "to", "type": {"value": {"Type": {"type": "AccountNumber"}}}, "attributes": []},
                              {"name": "amount", "type": {"value": {"Type": {"type": "@2"}}}, "attributes": []}],
                              "attributes": [{"name": "tuple", "value": "named"}]}}}, "attributes": []},
                          {"name": "AccountNumber", "type": {"value": {"Custom": {"type": {"value": {"Object": {"members": [
                              {"name": "value", "type": {"value": {"Type": {"type": "@2"}}}, "attributes": []}],
                              "attributes": [{"name": "definitionWillNotChange", "value": ""}]}}}, "id": "AccountNumber"}}}, "attributes": []},
                          {"name": "@2", "type": {"value": {"Int": {"bits": 64, "isSigned": False}}}, "attributes": []}],
                      "ir_version": 1},
            "actions": {"credit": {"params": {"value": {"Type": {"type": "@0"}}}, "result": {"value": {"Type": {"type": "@2"}}}}},
            "history": {}, "merkle": {}, "database": None}
        credit = ServiceSchema(document).actions[psio.method_to_number('credit')]
        packed = '1000B82A1B83AEDF040500000000000000'
        self.assertEqual(credit.params.json_to_pssz('{"to":"alice","amount":5}').hex().upper(), packed)
        self.assertEqual(credit.params.json_to_pssz('["alice",5]').hex().upper(), packed)
        self.assertEqual(credit.params.pssz_to_json(bytes.fromhex(packed)), '{"to":"alice","amount":5}')
        self.assertEqual(credit.result.from_pssz(bytes.fromhex('0700000000000000')), 7)

if __name__ == '__main__':
    unittest.main()
