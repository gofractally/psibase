#!/usr/bin/env python3
"""Compare historical, expanded, and ecosystem-balanced external-only training.

All profiles use identical evaluation names. Complete service families are held
out, and every exact lowercase training spelling is removed from novel tests.
No Psibase spelling is training data. Python timing is not a dispatch benchmark.
"""
import argparse
from collections import Counter, defaultdict
import hashlib
import json
from pathlib import Path
import random
import time

import benchmark as codec

HERE = Path(__file__).resolve().parent


def family(row):
    return row['source'] + ':' + row['split_group']


def hierarchy_weights(rows):
    """Equal ecosystems, providers within each, sources within each provider.

    Each source distributes its vote equally among its distinct full spellings.
    Repeat declarations/overloads/platform variants therefore add no weight.
    A spelling shared by sources receives their summed contributions.
    """
    names = defaultdict(set)
    for row in rows:
        names[(row['ecosystem'], row['provider'], row['source'])].add(row['method'])
    ecosystems = {key[0] for key in names}
    providers = {ecosystem: {key[1] for key in names if key[0] == ecosystem}
                 for ecosystem in ecosystems}
    sources = {key[:2]: {item[2] for item in names if item[:2] == key[:2]} for key in names}
    weights, contribution = Counter(), {}
    for (ecosystem, provider, source), spellings in sorted(names.items()):
        mass = 1 / len(ecosystems) / len(providers[ecosystem]) / len(sources[(ecosystem, provider)])
        contribution[source] = {'ecosystem': ecosystem, 'provider': provider,
                                'mass': mass, 'spellings': len(spellings)}
        for name in sorted(spellings):
            weights[name] += mass / len(spellings)
    assert abs(sum(weights.values()) - 1) < 1e-9
    return dict(weights), contribution


def make_split(records, preferred, leave_out=None, leave_out_provider=None):
    train, heldout = [], []
    for row in records:
        is_test = (row['provider'] == leave_out_provider if leave_out_provider else
                   row['ecosystem'] == leave_out if leave_out else
                   int(hashlib.sha256(family(row).encode()).hexdigest(), 16) % 5 == 0)
        if is_test:
            heldout.append(row)
        elif row['method'].lower() not in preferred:
            train.append(row)
    seen = {row['method'].lower() for row in train}
    novel = [row for row in heldout if row['method'].lower() not in seen]
    assert not ({row['method'].lower() for row in novel} & seen)
    assert not ({family(row) for row in train} & {family(row) for row in heldout})
    assert not ({row['method'].lower() for row in train} & preferred)
    return train, heldout, novel


def summarize(names, outcomes):
    fits = [name for name in names if outcomes[name]['fits']]
    return {'names': len(names), 'readable': len(fits),
            'percent': round(100 * len(fits) / len(names), 2) if names else None,
            'length_bands': codec.length_bands(names, fits)}


def hierarchical_score(source_metrics, source_info):
    """Macro-average percentages using the same hierarchy as training."""
    providers = defaultdict(lambda: defaultdict(list))
    for source, result in source_metrics.items():
        if result['names']:
            info = source_info[source]
            providers[info['ecosystem']][info['provider']].append(result['percent'])
    ecosystems = {ecosystem: sum(sum(values) / len(values) for values in groups.values()) / len(groups)
                  for ecosystem, groups in providers.items()}
    return {'ecosystem_macro_percent': {key: round(value, 2) for key, value in sorted(ecosystems.items())},
            'balanced_macro_percent': round(sum(ecosystems.values()) / len(ecosystems), 2) if ecosystems else None}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    holdout = parser.add_mutually_exclusive_group()
    holdout.add_argument('--leave-out-ecosystem', choices=['cpp', 'rust', 'blockchain', 'service-api', 'javascript'])
    holdout.add_argument('--leave-out-provider', help='Hold out every source from one named provider')
    parser.add_argument('--output', type=Path, default=HERE / 'results-expanded.json')
    args = parser.parse_args()
    started = time.perf_counter()
    raw = (HERE / 'corpus-expanded.jsonl').read_bytes()
    metadata = json.loads((HERE / 'corpus-expanded-metadata.json').read_text())
    assert hashlib.sha256(raw).hexdigest() == metadata['sha256'], 'expanded metadata is stale'
    records = [json.loads(line) for line in raw.decode().splitlines()]
    assert all(row['source'] != 'psibase' for row in records)
    preferred_rows = json.loads((HERE / 'preferred-names.json').read_text())['examples']
    preferred = {row['preferred'].lower() for row in preferred_rows}
    if args.leave_out_provider:
        assert args.leave_out_provider in {row['provider'] for row in records}
    train, heldout, novel = make_split(records, preferred, args.leave_out_ecosystem, args.leave_out_provider)
    historical_sources = {json.loads(line)['source'] for line in (HERE / 'corpus.jsonl').read_text().splitlines()}
    old_train = [row for row in train if row['source'] in historical_sources]
    sources = sorted({row['source'] for row in records})
    source_info = {source: {'ecosystem': next(row['ecosystem'] for row in records if row['source'] == source),
                            'provider': next(row['provider'] for row in records if row['source'] == source)}
                   for source in sources}
    datasets = {'heldout_all': sorted({row['method'] for row in heldout}),
                'novel_all': sorted({row['method'] for row in novel}),
                'preferred_descriptive_probes': sorted(row['preferred'] for row in preferred_rows),
                'psibase_compatibility': sorted({row['method'] for row in codec.local_methods()})}
    for source in sources:
        full = sorted({row['method'] for row in heldout if row['source'] == source})
        if full:
            datasets['heldout-source:' + source] = full
        subset = sorted({row['method'] for row in novel if row['source'] == source})
        if subset:
            datasets['source:' + source] = subset
    evaluation_names = sorted(set().union(*map(set, datasets.values())))
    cpp = codec.probe(codec.ROOT / 'build-method-names/codec-probe-cpp', evaluation_names)
    old_outcomes = {name: {'fits': not row['hashed'] and not row['panic'] and row['decoded'] == codec.legacy(name)}
                    for name, row in cpp.items()}
    baseline = {dataset: summarize(names, old_outcomes) for dataset, names in datasets.items()}
    baseline['macro'] = hierarchical_score({key[7:]: value for key, value in baseline.items() if key.startswith('source:')}, source_info)
    baseline['heldout_macro'] = hierarchical_score({key[15:]: value for key, value in baseline.items() if key.startswith('heldout-source:')}, source_info)
    balanced_weights, mass = hierarchy_weights(train)
    profiles = [('historical_unique', old_train, None), ('expanded_unique', train, None),
                ('expanded_balanced', train, balanced_weights)]
    if args.leave_out_ecosystem or args.leave_out_provider:
        profiles = [profiles[-1]]
    results = {}
    for label, rows, weights in profiles:
        names = sorted({row['method'] for row in rows})
        assert names and all(set(name.lower()) <= set(codec.ALPHABET) for name in names)
        char = codec.CharacterModel(names, 2, weights=weights)
        word = codec.WordModel(names, 2048, weights=weights)
        mixture = codec.HybridModel(char, word, literal=True)
        model_results = {}
        for model_name, model in [('char2', char), ('words2048', word), ('mixture', mixture)]:
            outcomes, same_id = {}, {}
            for name in evaluation_names:
                value, bits = codec.encode(model, name)
                outcomes[name] = {'fits': value is not None, 'bits': bits}
                if value is not None:
                    decoded = codec.decode(model, value)
                    assert decoded == name.lower(), (label, model_name, name, decoded)
                    assert codec.encode(model, decoded)[0] == value
                    assert value not in same_id or same_id[value] == decoded
                    same_id[value] = decoded
            for index in range(200):
                name = ''.join(random.Random(index).choices(codec.ALPHABET, k=1 + index % 32))
                value, _ = codec.encode(model, name)
                if value is not None:
                    assert codec.decode(model, value) == name
                    assert codec.encode(model, codec.decode(model, value))[0] == value
            metrics = {dataset: summarize(subset, outcomes) for dataset, subset in datasets.items()}
            metrics['macro'] = hierarchical_score({key[7:]: value for key, value in metrics.items() if key.startswith('source:')}, source_info)
            metrics['heldout_macro'] = hierarchical_score({key[15:]: value for key, value in metrics.items() if key.startswith('heldout-source:')}, source_info)
            model_results[model_name] = {'model': model.summary(), 'metrics': metrics,
                                         'probes': {name: outcomes[name] for name in datasets['preferred_descriptive_probes']}}
        results[label] = {'training_unique_spellings': len(names),
                          'training_sources': sorted({row['source'] for row in rows}),
                          'models': model_results}
        print(label, json.dumps({model: result['metrics']['macro'] for model, result in model_results.items()}), flush=True)
    output = {'scope': 'Experimental readable branches only; no production codec changes or CPU claims',
              'corpus_sha256': hashlib.sha256(raw).hexdigest(),
              'corpus_metadata_sha256': hashlib.sha256((HERE / 'corpus-expanded-metadata.json').read_bytes()).hexdigest(),
              'historical_corpus_sha256': hashlib.sha256((HERE / 'corpus.jsonl').read_bytes()).hexdigest(),
              'experiment_source_sha256': {name: hashlib.sha256((HERE / name).read_bytes()).hexdigest()
                                           for name in ('benchmark.py', 'expansion_benchmark.py', 'expand_corpus.py')},
              'codec_source_sha256': {name: hashlib.sha256((codec.ROOT / name).read_bytes()).hexdigest()
                                     for name in ('libraries/psio/include/psio/compress_name.hpp',
                                                  'rust/psibase_names/src/constants.rs',
                                                  'rust/psibase_names/src/method_to_number_converter.rs')},
              'split': {'family_rule': 'source:split_group SHA256 modulo5, residue0 held out',
                        'leave_out_ecosystem': args.leave_out_ecosystem,
                        'leave_out_provider': args.leave_out_provider,
                        'training_records': len(train), 'heldout_records': len(heldout),
                        'novel_records': len(novel), 'novel_names': len(datasets['novel_all']),
                        'novel_definition': 'No lowercase spelling in ANY expanded training source',
                        'shared_evaluation_across_profiles': True,
                        'psibase_and_preferred_names_excluded_from_all_training': True},
              'balance': {'rule': 'Equal ecosystems > equal providers > equal sources > equal distinct spellings',
                          'source_mass': mass},
              'source_info': source_info, 'baseline_current_cpp': baseline, 'profiles': results,
              'potential_normalization_equivalences_not_wire_collisions': {
                  'lookalike': codec.collisions(records, codec.lookalike),
                  'vowelless': codec.collisions(records, codec.vowels)},
              'evaluation_seconds': round(time.perf_counter() - started, 3)}
    args.output.write_text(json.dumps(output, indent=2) + '\n')
    print('Saved', args.output, flush=True)


if __name__ == '__main__':
    main()
