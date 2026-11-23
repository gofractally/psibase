#!/usr/bin/env python3
"""Frozen action-name export, malformed-input and exact-ID conformance tests."""
import copy
import hashlib
import json
import random
import unittest

import benchmark as codec
import action_name_model as action


class ActionNameTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.weights = {'registerEventIndex': 10, 'cancelPendingTokenTransfer': 10,
                       'requestAccountRecovery': 10, 'getBalance': 10, 'setBalance': 10,
                       'getUint32': 2, 'getInt32': 2, 'foo_bar': 1,
                       'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa': 10}
        cls.document = action.build_model(cls.weights)
        cls.model = action.load_model(cls.document)

    def test_export_complete_and_stable(self):
        self.assertEqual(len(self.document['character']['cdf_rows']), 1407)
        self.assertEqual(len(self.document['character']['contexts']), 1407)
        self.assertEqual(self.document, json.loads(action.canonical_json(self.document)))
        reverse = action.build_model(dict(reversed(list(self.weights.items()))))
        self.assertEqual(action.canonical_json(reverse), action.canonical_json(self.document))
        self.assertEqual(action.load_model(reverse).model_sha256, self.model.model_sha256)
        for row in self.document['character']['cdf_rows']:
            self.assertEqual((row[0], row[-1]), (0, 32768))
            self.assertTrue(all(left < right for left, right in zip(row, row[1:])))

    def test_all_readable_modes_and_case_digit_distinctions(self):
        examples = ['a', '_', 'foo_bar', 'fooqbar', 'foobar', 'load0', 'loado', 'load1', 'loadl',
                    'registerEventIndex', 'cancelPendingTokenTransfer', 'aaaaaaaaaa']
        modes = set()
        values = {}
        for name in examples:
            value = action.encode_name(self.model, name)
            modes.add(value >> 62)
            label = action.decode_name(self.model, value)
            self.assertEqual(action.encode_name(self.model, label), value)
            self.assertEqual(action.encode_name(self.model, name.upper()), value)
            self.assertNotIn(value, values)
            values[value] = name
            if value >> 62 != 3:
                self.assertEqual(label, name.lower())
        self.assertTrue({0, 1, 2} <= modes, modes)

    def test_hash_fallback_endian_domain_and_literals(self):
        name = 'z' * 256
        value = action.encode_name(self.model, name)
        self.assertEqual(value >> 62, 3)
        digest = hashlib.sha256(b'psibase.action_name.v1\0' + name.encode('ascii')).digest()
        expected = (3 << 62) | (int.from_bytes(digest[:8], 'little') & ((1 << 62) - 1))
        self.assertEqual(value, expected)
        self.assertEqual(action.decode_name(self.model, value), '#' + format(expected, '016x'))
        for value in (3 << 62, (3 << 62) + 1, (1 << 64) - 1):
            text = action.decode_name(self.model, value)
            self.assertEqual(action.encode_name(self.document, text), value)

    def test_strict_identifiers_and_hash_literals(self):
        for bad in ['', '1abc', 'a-b', 'a.b', 'a b', 'é', 'a\0', 'a\n', 'a' * 257,
                    '#', '#c00000000000000', '#c0000000000000000', '#C000000000000000',
                    '#8000000000000000', '#0000000000000000', '#c00000000000000g',
                    '#c000000000000000 ', None, 5]:
            with self.subTest(value=bad):
                with self.assertRaises(ValueError):
                    action.encode_name(self.model, bad)
        for bad in [-1, 1 << 64, True, 0.5, '1', None]:
            with self.assertRaises(ValueError):
                action.decode_name(self.model, bad)

    def test_readable_requires_canonical_id(self):
        # Literal mode's empty string is not a valid action name.
        with self.assertRaises(ValueError):
            action.decode_name(self.model, 2 << 62)
        # The same text can have several mathematical branch representations;
        # only the selected minimum (length, mode, payload) ID is accepted.
        name = 'a'
        canonical = action.encode_name(self.model, name)
        for mode, model in enumerate(self.model.readable.models):
            value, length = codec.encode(model, name)
            if value is not None and length <= 62:
                alternate = (mode << 62) | (value >> 1)
                if alternate != canonical:
                    with self.assertRaises(ValueError):
                        action.decode_name(self.model, alternate)

    def test_integer_segmentation_ties(self):
        # Equal costs select fewer tokens; equal cost and count select IDs.
        symbols = action.SYMBOLS + ['aa', 'ab', 'ba']
        counts = [1] * len(symbols)
        cdf = codec.quantize(counts)
        model = action.FrozenWordModel(symbols, tuple(cdf), [1] * len(symbols))
        self.assertEqual(model.tokenize('aa'), ['aa'])
        self.assertEqual(model.tokenize('aba'), ['a', 'ba'])

    def test_invalid_frozen_models_rejected(self):
        changes = [lambda doc: doc.update(format_version='other'),
                   lambda doc: doc['character']['cdf_rows'].pop(),
                   lambda doc: doc['character']['cdf_rows'][0].__setitem__(1, 0),
                   lambda doc: doc['character']['cdf_rows'][0].__setitem__(-1, 32767),
                   lambda doc: doc['word']['token_costs'].__setitem__(0, True),
                   lambda doc: doc['word']['token_costs'].__setitem__(0, -1),
                   lambda doc: doc['word']['symbols'].append('UPPER'),
                   lambda doc: doc['hash'].update(byte_order='big')]
        for change in changes:
            doc = copy.deepcopy(self.document)
            change(doc)
            with self.assertRaises(ValueError):
                action.load_model(doc)
        for bad in ({}, {'a': 0}, {'a': -1}, {'a': float('nan')}, {'a': float('inf')},
                    {'a': True}, {'1a': 1}, {'a': 10 ** 1000}, {'a': 1e308, 'b': 1e308}):
            with self.assertRaises(ValueError):
                action.build_model(bad)

    def test_random_full_id_and_name_round_trips(self):
        rng = random.Random(1863)
        for index in range(300):
            name = rng.choice('abcdefghijklmnopqrstuvwxyz_') + ''.join(rng.choices(action.ALPHABET, k=index % 80))
            value = action.encode_name(self.model, name)
            text = action.decode_name(self.model, value)
            self.assertEqual(action.encode_name(self.model, text), value)
            if value >> 62 != 3:
                self.assertEqual(text, name)
        # Unknown integers either reject canonically or round-trip exactly.
        for _ in range(500):
            value = rng.getrandbits(64)
            try:
                text = action.decode_name(self.model, value)
            except ValueError:
                continue
            self.assertEqual(action.encode_name(self.model, text), value)


if __name__ == '__main__':
    unittest.main()
