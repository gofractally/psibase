#!/usr/bin/env python3
"""Writes wif-vectors.json, the test vectors for Bitcoin's wallet import
format (WIF) that the C++, Rust, TypeScript and Python implementations all
read.

This is deliberately not one of those implementations: it uses hashlib and
integer arithmetic only, so that the vectors are an independent statement of
the format. It also checks itself against the strings published on the
Bitcoin wiki before it writes anything.

    python3 wif-vectors.py            # rewrites wif-vectors.json beside it
    python3 wif-vectors.py --check    # fails if the file is not current
"""
import hashlib
import json
import pathlib
import sys

ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

# secp256k1
P = 2**256 - 2**32 - 977
N = 0xFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFEBAAEDCE6AF48A03BBFD25E8CD0364141
G = (0x79BE667EF9DCBBAC55A06295CE870B07029BFCDB2DCE28D959F2815B16F81798,
     0x483ADA7726A3C4655DA4FBFC0E1108A8FD17B448A68554199C47D08FFB10D4B8)


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


def public_keys(secret):
    x, y = multiply(secret, G)
    compressed = bytes([2 + (y & 1)]) + x.to_bytes(32, 'big')
    uncompressed = b'\x04' + x.to_bytes(32, 'big') + y.to_bytes(32, 'big')
    return compressed.hex(), uncompressed.hex()


def base58(data):
    number = int.from_bytes(data, 'big')
    text = ''
    while number:
        number, digit = divmod(number, 58)
        text = ALPHABET[digit] + text
    return '1' * (len(data) - len(data.lstrip(b'\0'))) + text


def check(payload):
    return hashlib.sha256(hashlib.sha256(payload).digest()).digest()[:4]


def base58check(payload):
    return base58(payload + check(payload))


VERSION = {'mainnet': 0x80, 'testnet': 0xEF}


def wif(secret, compressed, network):
    payload = bytes([VERSION[network]]) + secret.to_bytes(32, 'big')
    return base58check(payload + (b'\x01' if compressed else b''))


def main():
    wiki = 0x0C28FCA386C7A227600B2FE50B7CAE11EC86D3BF1FBE471BE89827E19D72AA1D
    assert wif(wiki, False, 'mainnet') == '5HueCGU8rMjxEXxiPuD5BDku4MkFqeZyd4dZ1jvhTVqvbTLvyTJ'
    assert wif(wiki, True, 'mainnet') == 'KwdMAjGmerYanjeui5SHS7JkmpZvVipYvB2LJGU1ZxJwYvP98617'
    assert public_keys(1)[0] == '02' + '%064x' % G[0]

    valid = []
    for name, secret in [('bitcoin-wiki', wiki), ('one', 1), ('order-minus-one', N - 1)]:
        compressed_key, uncompressed_key = public_keys(secret)
        for network in ['mainnet', 'testnet']:
            for compressed in [False, True]:
                valid.append({
                    'name': '%s-%s-%s' % (name, network, 'compressed' if compressed else 'uncompressed'),
                    'secret': '%064x' % secret,
                    'compressed': compressed,
                    'network': network,
                    'wif': wif(secret, compressed, network),
                    'publicKeyCompressed': compressed_key,
                    'publicKeyUncompressed': uncompressed_key,
                })

    good = wif(wiki, True, 'mainnet')
    old = wif(wiki, False, 'mainnet')
    # Text that decodes to the same key as `wif`: ASCII white space (space,
    # tab, carriage return, line feed) is dropped at the ends.
    whitespace = [
        {'name': 'trailing-newline', 'text': good + '\n', 'wif': good},
        {'name': 'crlf', 'text': good + '\r\n', 'wif': good},
        {'name': 'both-ends', 'text': ' \t' + old + ' \n', 'wif': old},
    ]

    def raw(version, body):
        return base58check(bytes([version]) + body)

    secret = wiki.to_bytes(32, 'big')
    last = ALPHABET[(ALPHABET.index(good[-1]) + 1) % 58]
    # `error` is the first rule the text breaks, in the order the rules are
    # checked: characters, length, check digits, version, flag, secret.
    # `looksLikeWif` is the answer of the cheap shape test.
    invalid = [
        {'name': 'bad-checksum', 'text': good[:-1] + last, 'error': 'bad-checksum', 'looksLikeWif': True},
        {'name': 'bad-checksum-uncompressed', 'text': old[:20] + ('2' if old[20] != '2' else '3') + old[21:],
         'error': 'bad-checksum', 'looksLikeWif': True},
        {'name': 'secret-31-bytes', 'text': raw(0x80, secret[:31]), 'error': 'bad-length', 'looksLikeWif': False},
        {'name': 'secret-34-bytes', 'text': raw(0x80, secret + b'\x01\x01'), 'error': 'bad-length', 'looksLikeWif': False},
        # One character short still has a plausible shape; the check digits catch it
        {'name': 'last-character-missing', 'text': good[:-1], 'error': 'bad-checksum', 'looksLikeWif': True},
        {'name': 'truncated', 'text': good[:40], 'error': 'bad-length', 'looksLikeWif': False},
        {'name': 'empty', 'text': '', 'error': 'bad-length', 'looksLikeWif': False},
        {'name': 'only-spaces', 'text': '  \n', 'error': 'bad-length', 'looksLikeWif': False},
        {'name': 'very-long', 'text': good * 8, 'error': 'bad-length', 'looksLikeWif': False},
        {'name': 'version-00', 'text': raw(0x00, secret + b'\x01'), 'error': 'bad-version', 'looksLikeWif': False},
        {'name': 'version-00-uncompressed', 'text': raw(0x00, secret), 'error': 'bad-version', 'looksLikeWif': False},
        # The neighbouring version byte also gives a string that starts with L
        {'name': 'version-81', 'text': raw(0x81, secret + b'\x01'), 'error': 'bad-version', 'looksLikeWif': True},
        {'name': 'flag-02', 'text': raw(0x80, secret + b'\x02'), 'error': 'bad-flag', 'looksLikeWif': True},
        {'name': 'flag-00', 'text': raw(0x80, secret + b'\x00'), 'error': 'bad-flag', 'looksLikeWif': True},
        {'name': 'secret-zero', 'text': raw(0x80, bytes(32) + b'\x01'), 'error': 'bad-secret', 'looksLikeWif': True},
        {'name': 'secret-zero-uncompressed', 'text': raw(0x80, bytes(32)), 'error': 'bad-secret', 'looksLikeWif': True},
        {'name': 'secret-order', 'text': raw(0x80, N.to_bytes(32, 'big') + b'\x01'), 'error': 'bad-secret', 'looksLikeWif': True},
        {'name': 'secret-order-testnet', 'text': raw(0xEF, N.to_bytes(32, 'big') + b'\x01'), 'error': 'bad-secret', 'looksLikeWif': True},
        {'name': 'secret-order-plus-one', 'text': raw(0x80, (N + 1).to_bytes(32, 'big')), 'error': 'bad-secret', 'looksLikeWif': True},
        {'name': 'secret-all-ones', 'text': raw(0x80, b'\xff' * 32 + b'\x01'), 'error': 'bad-secret', 'looksLikeWif': True},
        {'name': 'character-zero', 'text': good[:10] + '0' + good[11:], 'error': 'bad-character', 'looksLikeWif': False},
        {'name': 'character-capital-o', 'text': good[:10] + 'O' + good[11:], 'error': 'bad-character', 'looksLikeWif': False},
        {'name': 'character-capital-i', 'text': good[:10] + 'I' + good[11:], 'error': 'bad-character', 'looksLikeWif': False},
        {'name': 'character-small-l', 'text': good[:10] + 'l' + good[11:], 'error': 'bad-character', 'looksLikeWif': False},
        {'name': 'character-plus', 'text': good[:-1] + '+', 'error': 'bad-character', 'looksLikeWif': False},
        {'name': 'space-inside', 'text': good[:26] + ' ' + good[26:], 'error': 'bad-character', 'looksLikeWif': False},
        {'name': 'newline-inside', 'text': good[:26] + '\n' + good[26:], 'error': 'bad-character', 'looksLikeWif': False},
        {'name': 'no-break-space-at-end', 'text': good + ' ', 'error': 'bad-character', 'looksLikeWif': False},
        {'name': 'pem', 'text': '-----BEGIN PRIVATE KEY-----', 'error': 'bad-character', 'looksLikeWif': False},
    ]
    for case in invalid:
        assert case['text'] != good and case['text'] != old, case['name']
    # Every string of the right shape starts with one of these
    for case in valid:
        assert case['wif'][0] in {('mainnet', False): '5', ('mainnet', True): 'KL',
                                  ('testnet', False): '9', ('testnet', True): 'c'}[(case['network'], case['compressed'])]
        assert len(case['wif']) == (52 if case['compressed'] else 51)

    text = json.dumps({
        'description': 'Bitcoin wallet import format (WIF) vectors for secp256k1 private keys. '
                       'Written by wif-vectors.py beside this file; read by the C++, Rust, TypeScript '
                       'and Python tests. Do not edit by hand.',
        'valid': valid,
        'whitespace': whitespace,
        'invalid': invalid,
    }, indent=1, ensure_ascii=True) + '\n'
    path = pathlib.Path(__file__).with_name('wif-vectors.json')
    if '--check' in sys.argv[1:]:
        if path.read_text() != text:
            sys.exit('wif-vectors.json is not what wif-vectors.py writes')
    else:
        path.write_text(text)


if __name__ == '__main__':
    main()
