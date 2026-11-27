#!/usr/bin/env python3
"""Derives the key of the `guest` account and writes guest-key.json.

`guest` is an ordinary account that nobody can authorize (gofractally/psibase
#2307). Its owner and active key are one secp256k1 point that is derived
here from a public sentence, so that anyone can see that nobody chose it
from a private key:

    x = SHA-256(seed || counter as 4 bytes, little-endian)

for counter = 0, 1, 2, ... until x, read as a big-endian integer, is below
the field prime p and x^3 + 7 is a square modulo p. The point is (x, y) with
the even y. Finding a private key for it means computing a discrete
logarithm on secp256k1.

secp256k1 has prime order and cofactor 1, so every point on the curve other
than the point at infinity is an ordinary public key: there are no points of
low order to land on.

This uses hashlib and integer arithmetic only, so that it is an independent
statement of the derivation.

    python3 guest-key.py            # rewrites guest-key.json beside it
    python3 guest-key.py --check    # fails if guest-key.json, postinstall.json
                                    # or GuestAccount.hpp disagree with it
"""
import base64
import hashlib
import json
import pathlib
import re
import sys

ACCOUNT = 'guest'
SEED = 'psibase guest account: nobody holds this key'

# secp256k1: y^2 = x^3 + 7 over the field of P elements; N points.
P = 2**256 - 2**32 - 977
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
     0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)

# AlgorithmIdentifier { id-ecPublicKey, secp256k1 }, as psibase/verifier.hpp
K1_ALGORITHM = bytes.fromhex('301006072a8648ce3d020106052b8104000a')


def candidate(counter):
    digest = hashlib.sha256(SEED.encode('ascii') + counter.to_bytes(4, 'little')).digest()
    return int.from_bytes(digest, 'big')


def lift(x):
    """The even y with y^2 = x^3 + 7, or None if x is not on the curve"""
    if x >= P:
        return None
    square = (pow(x, 3, P) + 7) % P
    # P = 3 (mod 4), so a square root, if there is one, is square^((P+1)/4)
    y = pow(square, (P + 1) // 4, P)
    if y * y % P != square:
        return None
    return y if y % 2 == 0 else P - y


def derive():
    counter = 0
    while True:
        x = candidate(counter)
        y = lift(x)
        if y is not None:
            return counter, x, y
        counter += 1


def add(a, b):
    if a is None:
        return b
    if b is None:
        return a
    if a[0] == b[0] and (a[1] + b[1]) % P == 0:
        return None
    if a == b:
        slope = 3 * a[0] * a[0] * pow(2 * a[1], -1, P) % P
    else:
        slope = (b[1] - a[1]) * pow(b[0] - a[0], -1, P) % P
    x = (slope * slope - a[0] - b[0]) % P
    return (x, (slope * (a[0] - x) - a[1]) % P)


def multiply(k, point):
    result = None
    while k:
        if k & 1:
            result = add(result, point)
        point = add(point, point)
        k >>= 1
    return result


def spki(point):
    """DER SubjectPublicKeyInfo of a compressed secp256k1 point"""
    bits = b'\x03' + bytes([len(point) + 1]) + b'\x00' + point
    body = K1_ALGORITHM + bits
    return b'\x30' + bytes([len(body)]) + body


def pem(der):
    text = base64.b64encode(der).decode('ascii')
    lines = [text[i:i + 64] for i in range(0, len(text), 64)]
    return '-----BEGIN PUBLIC KEY-----\n' + '\n'.join(lines) + '\n-----END PUBLIC KEY-----\n'


def self_check(counter, x, y):
    # The derivation is what the docstring says it is.
    for earlier in range(counter):
        assert lift(candidate(earlier)) is None
    assert x == candidate(counter) and x < P
    # On the curve, with the even y.
    assert (y * y - x * x * x - 7) % P == 0 and y % 2 == 0 and 0 < y < P
    # An ordinary point: of the full (prime) order, and none of the points
    # whose private key is known to everybody (small multiples of the
    # generator and their negations, which share their x).
    assert multiply(N, (x, y)) is None
    assert multiply(N, G) is None
    known = None
    for _ in range(1024):
        known = add(known, G)
        assert known[0] != x


def tree_keys(here):
    """The x-coordinates of the secp256k1 keys that the tree publishes with
    their private keys (the WIF test vectors)"""
    path = here / '../../../libraries/psibase/common/tests/wif-vectors.json'
    vectors = json.loads(path.read_text())
    return {v['publicKeyCompressed'][2:] for v in vectors['valid']}


def expected():
    counter, x, y = derive()
    self_check(counter, x, y)
    point = b'\x02' + x.to_bytes(32, 'big')
    der = spki(point)
    return {
        'description': 'The key of the `guest` account, which nobody can authorize '
                       '(gofractally/psibase #2307). Written by guest-key.py beside this file; '
                       'see there for the derivation. Do not edit by hand.',
        'account': ACCOUNT,
        'seed': SEED,
        'counter': counter,
        'x': x.to_bytes(32, 'big').hex(),
        'y': y.to_bytes(32, 'big').hex(),
        'point': point.hex(),
        'spki': der.hex(),
        'fingerprint': hashlib.sha256(der).hexdigest(),
        'pem': pem(der),
    }


def check(here, value, text):
    problems = []
    if value['x'] in tree_keys(here):
        problems.append('the derived key is a key of the WIF test vectors')
    if (here / 'guest-key.json').read_text() != text:
        problems.append('guest-key.json is not what guest-key.py writes')

    # The actions that create the account at boot. An action's data is
    # written as its schema says: a key is the hex of its DER bytes.
    actions = json.loads((here / 'postinstall.json').read_text())
    creations = [a for a in actions if a['method'] == 'newAccount']
    keyed = [a for a in actions if a['method'] == 'initKeys']
    if (len(creations) != 1 or len(keyed) != 1 or creations[0]['data']['name'] != ACCOUNT
            or keyed[0]['data']['account'] != ACCOUNT):
        problems.append('postinstall.json does not create exactly the account ' + ACCOUNT)
    else:
        for role in ('owner', 'active'):
            spec = keyed[0]['data'][role]
            if spec['key'] != value['spki'] or spec['seq'] != 0 or spec['verifier'] is not None:
                problems.append('postinstall.json: the %s key is not the derived key' % role)

    # The constants that C++ reads
    header = (here / 'include/services/system/GuestAccount.hpp').read_text()

    def constant(pattern):
        found = re.search(pattern, header, re.S)
        return found.group(1) if found else None

    if constant(r'account\{"([^"]*)"\}') != value['account']:
        problems.append('GuestAccount.hpp: account')
    if constant(r'keySeed\[\]\s*=\s*"([^"]*)"') != value['seed']:
        problems.append('GuestAccount.hpp: keySeed')
    if constant(r'keyCounter\s*=\s*(\d+)') != str(value['counter']):
        problems.append('GuestAccount.hpp: keyCounter')
    array = constant(r'keySpki\[\]\s*=\s*\{(.*?)\}')
    if array is None or bytes(int(b, 16) for b in re.findall(r'0x([0-9a-fA-F]{2})', array)).hex() != value['spki']:
        problems.append('GuestAccount.hpp: keySpki')
    return problems


def main():
    here = pathlib.Path(__file__).parent
    value = expected()
    text = json.dumps(value, indent=1) + '\n'
    if '--check' in sys.argv[1:]:
        problems = check(here, value, text)
        if problems:
            sys.exit('\n'.join(problems))
    else:
        (here / 'guest-key.json').write_text(text)
        for name in ('seed', 'counter', 'point', 'spki', 'fingerprint'):
            print('%-12s%s' % (name, value[name]))
        print(value['pem'], end='')


if __name__ == '__main__':
    main()
