#!/usr/bin/env python3
"""Converts Wycheproof ECDSA P1363 vectors into text cases for gen_cases.

Download into the current directory first:
  https://raw.githubusercontent.com/C2SP/wycheproof/main/testvectors_v1/ecdsa_secp256k1_sha256_p1363_test.json
  https://raw.githubusercontent.com/C2SP/wycheproof/main/testvectors_v1/ecdsa_secp256r1_sha256_p1363_test.json

Each output line: sha256(msg) key-der signature expected-canonical expected-either-s label
A vector Wycheproof calls valid is expected to be rejected by the canonical
(low-S) verifier when its s is above n/2.
"""
import hashlib
import json
import sys

ORDER = {
    'secp256k1': 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141,
    'secp256r1': 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551,
}

out = open(sys.argv[1] if len(sys.argv) > 1 else 'wycheproof.txt', 'w')
for curve, order in ORDER.items():
    data = json.load(open(f'ecdsa_{curve}_sha256_p1363_test.json'))
    for group in data['testGroups']:
        key = group['publicKeyDer']
        for test in group['tests']:
            digest = hashlib.sha256(bytes.fromhex(test['msg'])).hexdigest()
            sig = test['sig']
            valid = test['result'] == 'valid'
            high = valid and len(sig) == 128 and int(sig[64:], 16) > order // 2
            canonical = 1 if valid and not high and len(sig) == 128 else 0
            label = f"wycheproof-{curve}-{test['tcId']}" + ('-highS' if high else '')
            out.write(f"{digest} {key} {sig or '-'} {canonical} {1 if valid else 0} {label}\n")
