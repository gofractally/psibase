#!/usr/bin/python

# Bitcoin's wallet import format as psinode.py implements it, against
# libraries/psibase/common/tests/wif-vectors.json: the file that the C++
# definition (psibase/wif.hpp), Rust's psibase::wif and common-lib's wif.ts
# are tested against too.

import json
import pathlib
import unittest
from psinode import PrivateKey, WifError, looks_like_wif, verifier_for, wif_decode, wif_encode

with open(pathlib.Path(__file__).parent / '../../../libraries/psibase/common/tests/wif-vectors.json') as f:
    VECTORS = json.load(f)

K1_ALGORITHM = bytes.fromhex('301006072a8648ce3d020106052b8104000a')

def spki(point):
    '''SubjectPublicKeyInfo of a secp256k1 point'''
    return bytes([0x30, len(K1_ALGORITHM) + 3 + len(point)]) + K1_ALGORITHM + bytes([0x03, len(point) + 1, 0x00]) + point

class TestWif(unittest.TestCase):
    def test_valid(self):
        self.assertGreaterEqual(len(VECTORS['valid']), 12)
        for v in VECTORS['valid']:
            with self.subTest(v['name']):
                secret = bytes.fromhex(v['secret'])
                self.assertEqual(wif_encode(secret, v['compressed'], v['network']), v['wif'])
                self.assertTrue(looks_like_wif(v['wif']))
                key = wif_decode(v['wif'])
                self.assertEqual(key.secret, secret)
                self.assertEqual(key.compressed, v['compressed'])
                self.assertEqual(key.network, v['network'])
                self.assertNotIn(v['secret'][:8], repr(key))

                # Key derivation agrees, and a key read from WIF claims the
                # public key in the form the string asks for
                private = PrivateKey(v['wif'])
                point = bytes.fromhex(v['publicKeyCompressed' if v['compressed'] else 'publicKeyUncompressed'])
                self.assertEqual(private.spki_der(), spki(point))
                self.assertEqual(private.claim(), {'service': 'verify-k1', 'rawData': spki(point)})
                self.assertEqual(verifier_for(private.spki_der()), 'verify-k1')
                self.assertEqual(private.wif(network=v['network']), v['wif'])
                other = bytes.fromhex(v['publicKeyUncompressed' if v['compressed'] else 'publicKeyCompressed'])
                self.assertEqual(PrivateKey(private.wif(compressed=not v['compressed'])).spki_der(), spki(other))

    def test_defaults(self):
        secret = bytes.fromhex('0c28fca386c7a227600b2fe50b7cae11ec86d3bf1fbe471be89827e19d72aa1d')
        self.assertEqual(wif_encode(secret), 'KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617')

    def test_whitespace(self):
        self.assertGreater(len(VECTORS['whitespace']), 0)
        for v in VECTORS['whitespace']:
            with self.subTest(v['name']):
                self.assertTrue(looks_like_wif(v['text']))
                self.assertEqual(wif_decode(v['text']), wif_decode(v['wif']))

    def test_invalid(self):
        self.assertGreaterEqual(len(VECTORS['invalid']), 20)
        for v in VECTORS['invalid']:
            with self.subTest(v['name']):
                with self.assertRaises(WifError) as raised:
                    wif_decode(v['text'])
                self.assertEqual(raised.exception.reason, v['error'])
                self.assertNotEqual(str(raised.exception), '')
                self.assertEqual(looks_like_wif(v['text']), v['looksLikeWif'])

    def test_encode_refuses_keys_outside_the_group(self):
        order = bytes.fromhex('fffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141')
        for secret in [bytes(32), order, bytes(31)]:
            with self.assertRaises(WifError) as raised:
                wif_encode(secret)
            self.assertEqual(raised.exception.reason, 'bad-secret')

    def test_pem_key_keeps_the_uncompressed_form(self):
        '''A key that did not come from WIF claims the uncompressed point, as before; its WIF is the 5... form'''
        key = PrivateKey()
        self.assertEqual(len(key.spki_der()), 23 + 65)
        self.assertEqual(PrivateKey(key.pkcs8()).spki_der(), key.spki_der())
        self.assertTrue(key.wif().startswith('5'))
        self.assertEqual(PrivateKey(key.wif()).spki_der(), key.spki_der())
        compressed = PrivateKey(key.wif(compressed=True))
        self.assertIn(key.wif(compressed=True)[0], 'KL')
        self.assertEqual(len(compressed.spki_der()), 23 + 33)
        self.assertIn('BEGIN PUBLIC KEY', compressed.spki())

if __name__ == '__main__':
    unittest.main()
