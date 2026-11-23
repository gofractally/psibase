#!/usr/bin/env python3
"""Checks for leakage, corpus weighting, and prototype decoding correctness."""
import hashlib
import json
from pathlib import Path
import unittest

import benchmark as codec
from expansion_benchmark import family, hierarchy_weights, make_split

HERE = Path(__file__).resolve().parent


def record(source, ecosystem, provider, method, group='api'):
    return {'source': source, 'ecosystem': ecosystem, 'provider': provider,
            'method': method, 'service': group, 'split_group': group}


class ExpansionTests(unittest.TestCase):
    def test_duplicates_do_not_purchase_training_weight(self):
        rows = [record('a', 'cpp', 'one', 'read'), record('a', 'cpp', 'one', 'write'),
                record('b', 'cpp', 'two', 'allocate'), record('c', 'rust', 'three', 'borrow')]
        weights, mass = hierarchy_weights(rows)
        self.assertEqual((weights, mass), hierarchy_weights(rows + [rows[0]] * 1000))
        self.assertAlmostEqual(weights['borrow'], .5)
        self.assertAlmostEqual(weights['allocate'], .25)
        self.assertAlmostEqual(weights['read'] + weights['write'], .25)

    def test_many_libraries_do_not_overweight_one_provider(self):
        rows = [record('a', 'cpp', 'boost', 'read'), record('b', 'cpp', 'boost', 'write'),
                record('c', 'cpp', 'llvm', 'allocate'), record('d', 'rust', 'rust', 'borrow')]
        weights, _ = hierarchy_weights(rows)
        self.assertAlmostEqual(weights['read'] + weights['write'], weights['allocate'])
        self.assertAlmostEqual(sum(weights[name] for name in ('read', 'write', 'allocate')), weights['borrow'])

    def test_novel_test_excludes_cross_project_case_overlap(self):
        def row_for(test, name):
            for index in range(1000):
                row = record('source', 'cpp', 'one', name, str(index))
                selected = int(hashlib.sha256(family(row).encode()).hexdigest(), 16) % 5 == 0
                if selected == test:
                    return row
            self.fail('cannot construct split fixture')
        rows = [row_for(False, 'GetData'), row_for(True, 'getData'),
                row_for(True, 'getFreshData'), row_for(False, 'reservedProbe')]
        train, heldout, novel = make_split(rows, {'reservedprobe'})
        self.assertEqual([row['method'] for row in train], ['GetData'])
        self.assertEqual({row['method'] for row in heldout}, {'getData', 'getFreshData'})
        self.assertEqual([row['method'] for row in novel], ['getFreshData'])

    def test_weighted_readable_branches_round_trip(self):
        names = ['registerEventIndex', 'cancelPendingTokenTransfer', 'getUint32',
                 'getInt32', 'async_read_some', 'setPublicKey', 'o0_l1', 'sx', 'szziat']
        weights = {name: index + 1 for index, name in enumerate(names)}
        char = codec.CharacterModel(names, 2, weights=weights)
        words = codec.WordModel(names, 128, weights=weights)
        mixture = codec.HybridModel(char, words, literal=True)
        for model in (char, words, mixture):
            values = {}
            for name in names:
                value, _ = codec.encode(model, name)
                if value is not None:
                    self.assertEqual(codec.decode(model, value), name.lower())
                    self.assertEqual(codec.encode(model, codec.decode(model, value))[0], value)
                    self.assertNotIn(value, values)
                    values[value] = name
            self.assertGreater(len(values), 3)

    def test_original_unweighted_probe_results_are_preserved(self):
        records = [json.loads(line) for line in (HERE / 'corpus.jsonl').read_text().splitlines()]
        probes = json.loads((HERE / 'preferred-names.json').read_text())['examples']
        preferred = {row['preferred'].lower() for row in probes}
        names = sorted({row['method'] for row in records
                        if int(hashlib.sha256(family(row).encode()).hexdigest(), 16) % 5 != 0
                        and row['method'].lower() not in preferred})
        expected = json.loads((HERE / 'results-external.json').read_text())['preferred_descriptive_probes']
        char = codec.CharacterModel(names, 2)
        words = codec.WordModel(names, 2048)
        models = {'trained_char2': char, 'trained_words2048': words,
                  'trained_hybrid_words2048_literal': codec.HybridModel(char, words, True)}
        for label, model in models.items():
            for name, result in expected.items():
                value, bits = codec.encode(model, name)
                self.assertEqual(bits, result['candidates'][label]['bits'], (name, label))
                self.assertEqual(value is not None, result['candidates'][label]['readable'], (name, label))


if __name__ == '__main__':
    unittest.main()
