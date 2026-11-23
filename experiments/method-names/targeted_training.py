#!/usr/bin/env python3
"""Measure adding four known compression misses to the frozen balanced corpus.

An ordinary added name receives the average vote of one existing spelling.
Higher multipliers are explicit targeted weighting, not extra independent data.
The original external-only artifacts and production codec are unchanged.
"""
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import time

import benchmark as codec
from expansion_benchmark import hierarchy_weights, hierarchical_score, make_split

HERE = Path(__file__).resolve().parent
TARGETS = ['cpu_blocks_avg', 'cpu_thresholds', 'set_guild_weight_curve', 'unreg_res_provider']


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def main():
    started = time.perf_counter()
    reference_path = HERE / 'results-expanded.json'
    reference = json.loads(reference_path.read_text())
    assert sha(HERE / 'corpus-expanded.jsonl') == reference['corpus_sha256']
    for name, digest in reference['experiment_source_sha256'].items():
        assert sha(HERE / name) == digest, name
    records = [json.loads(line) for line in (HERE / 'corpus-expanded.jsonl').read_text().splitlines()]
    assert not (set(TARGETS) & {row['method'].lower() for row in records})
    preferred = {row['preferred'] for row in json.loads((HERE / 'preferred-names.json').read_text())['examples']}
    train, _, novel = make_split(records, {name.lower() for name in preferred})
    base_weights, _ = hierarchy_weights(train)
    ordinary_vote = sum(base_weights.values()) / len(base_weights)
    local = sorted({row['method'] for row in codec.local_methods()})
    assert len(local) == reference['baseline_current_cpp']['psibase_compatibility']['names']
    external = sorted({row['method'] for row in novel})
    assert len(external) == reference['split']['novel_names']
    assert not (set(TARGETS) & {name.lower() for name in external})
    datasets = {'psibase': local, 'external_novel': external, 'preferred_probes': sorted(preferred)}
    all_names = sorted(set().union(*map(set, datasets.values())))
    source_names = defaultdict(set)
    for row in novel:
        source_names[row['source']].add(row['method'])
    baseline_fits, results = None, {}
    for multiplier in (0, 1, 10, 100, 1000):
        weights = dict(base_weights)
        if multiplier:
            for name in TARGETS:
                assert name not in weights
                weights[name] = ordinary_vote * multiplier
        names = sorted(weights)
        char = codec.CharacterModel(names, 2, weights=weights)
        words = codec.WordModel(names, 2048, weights=weights)
        model = codec.HybridModel(char, words, literal=True)
        fits, bits, wire_values = set(), {}, {}
        for name in all_names:
            value, length = codec.encode(model, name)
            bits[name] = length
            if value is not None:
                canonical = name.lower()
                assert codec.decode(model, value) == canonical, (multiplier, name)
                assert codec.encode(model, canonical)[0] == value
                assert value not in wire_values or wire_values[value] == canonical
                wire_values[value] = canonical
                fits.add(name)
        if baseline_fits is None:
            baseline_fits = fits
            assert sorted(set(local) - fits) == TARGETS
        metrics = {}
        for label, subset in datasets.items():
            current, original = set(subset) & fits, set(subset) & baseline_fits
            lost, gained = sorted(original - current), sorted(current - original)
            metrics[label] = {'names': len(subset), 'readable': len(current),
                              'percent': round(100 * len(current) / len(subset), 2),
                              'lost_from_baseline': lost, 'gained_from_baseline': gained,
                              'misses': sorted(set(subset) - current),
                              'length_bands': codec.length_bands(subset, current)}
        source_metrics = {source: {'names': len(subset),
                                  'percent': round(100 * len(subset & fits) / len(subset), 2)}
                          for source, subset in source_names.items()}
        macro = hierarchical_score(source_metrics, reference['source_info'])
        if not multiplier:
            expected = reference['profiles']['expanded_balanced']['models']['mixture']['metrics']
            assert metrics['psibase']['readable'] == expected['psibase_compatibility']['readable']
            assert metrics['external_novel']['readable'] == expected['novel_all']['readable']
            assert macro == expected['macro']
        mass = len(TARGETS) * ordinary_vote * multiplier
        results[str(multiplier)] = {'added_vote_multiplier': multiplier,
                                    'target_fraction_of_total_training_mass': mass / (1 + mass),
                                    'metrics': metrics, 'external_macro': macro,
                                    'targets': {name: {'fits': name in fits,
                                                       'minimum_arithmetic_payload_bits': bits[name],
                                                       'char2_payload_bits': codec.encode(char, name)[1],
                                                       'word_payload_bits': codec.encode(words, name)[1]}
                                                for name in TARGETS},
                                    'dictionary': words.summary()}
        print(json.dumps({'multiplier': multiplier,
                          'psibase': metrics['psibase']['readable'],
                          'external_novel': metrics['external_novel']['readable'],
                          'external_gained': len(metrics['external_novel']['gained_from_baseline']),
                          'external_lost': len(metrics['external_novel']['lost_from_baseline']),
                          'external_macro': macro['balanced_macro_percent'],
                          'misses': metrics['psibase']['misses']}), flush=True)
    output = {'scope': 'Targeted in-sample fitting experiment; fixed architecture and external test set',
              'targets': TARGETS, 'ordinary_vote': ordinary_vote,
              'base_training_unique_spellings': len(base_weights),
              'weighting_rule': 'Preserve original relative weights; each target receives mean original name vote times multiplier',
              'no_target_in_external_corpus_or_test': True,
              'preferred_probes_excluded_from_training': True,
              'external_tests_frozen_before_targeted_training': True,
              'corpus_sha256': reference['corpus_sha256'],
              'reference_results_sha256': sha(reference_path),
              'source_sha256': {name: sha(HERE / name) for name in
                                ('targeted_training.py', 'benchmark.py', 'expansion_benchmark.py')},
              'profiles': results, 'evaluation_seconds': round(time.perf_counter() - started, 3)}
    destination = HERE / 'results-targeted-training.json'
    destination.write_text(json.dumps(output, indent=2) + '\n')
    print('Saved', destination, flush=True)


if __name__ == '__main__':
    main()
