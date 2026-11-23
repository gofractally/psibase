#!/usr/bin/env python3
"""Bounded development updates for a saved action_name training/model bundle.

This tool writes candidate artifacts, never production source or deployed IDs.
Release locks require native-language conformance evidence; the Python reference
alone cannot satisfy that gate. See doc/src/development/action-name-training.md.
"""
import argparse
from collections import defaultdict
from contextlib import contextmanager
import hashlib
import json
import math
import os
from pathlib import Path
import re
import tempfile

import benchmark as codec
from expansion_benchmark import hierarchy_weights, hierarchical_score, make_split
from action_name_model import build_model, load_model, encode_name, decode_name, canonical_json

HERE = Path(__file__).resolve().parent
DEFAULT_POLICY = {
    'max_multiplier': 10, 'max_target_mass': 0.0025,
    'max_step_factor': 2, 'max_target_names': 32,
    'max_external_macro_drop_pp': 0.25, 'max_ecosystem_drop_pp': 1.0,
    'max_external_lost_fraction': 0.005,
}
NAME = re.compile(r'[A-Za-z_][A-Za-z_0-9]{0,255}\Z')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def read(path):
    return json.loads(Path(path).read_text())


def write(path, value):
    path = Path(path)
    path.write_bytes(canonical_json(value) + b'\n')


def assert_development(pack):
    if (Path(pack) / 'release.lock').exists():
        raise ValueError('Training bundle is release-locked; use a new format/version for future experiments')


def validate_weights(base_weights, current, requested, policy):
    if not isinstance(current, dict) or not isinstance(requested, dict):
        raise ValueError('Weight ledgers must be objects')
    if not base_weights or any(not math.isfinite(value) or value <= 0 for value in base_weights.values()):
        raise ValueError('Base weights must be finite and positive')
    if len(requested) > policy['max_target_names']:
        raise ValueError('Too many targeted names')
    canonical = set()
    for name, value in requested.items():
        if not isinstance(name, str) or not NAME.fullmatch(name):
            raise ValueError('Target name must be an ASCII identifier of 1..256 characters')
        if name.lower() in canonical:
            raise ValueError('Case-folded target names must be unique')
        canonical.add(name.lower())
        if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value) or value <= 0:
            raise ValueError('Multiplier must be finite and positive')
        if value > policy['max_multiplier']:
            raise ValueError('Per-name multiplier exceeds the cumulative cap')
        prior = next((weight for old_name, weight in current.items() if old_name.lower() == name.lower()), None)
        maximum = 1 if prior is None else prior * policy['max_step_factor']
        if value > maximum:
            raise ValueError('Step exceeds the initial one-vote or per-update factor cap')
    ordinary = sum(base_weights.values()) / len(base_weights)
    extra = ordinary * sum(requested.values())
    if extra / (sum(base_weights.values()) + extra) > policy['max_target_mass']:
        raise ValueError('Targeted mass exceeds the cumulative baseline budget')
    return dict(sorted(requested.items()))


def merged_weights(base, ledger):
    result = dict(base)
    ordinary = sum(base.values()) / len(base)
    for name, value in ledger.items():
        result[name] = result.get(name, 0) + ordinary * value
    return result


def evaluate(document, evaluation):
    loaded = load_model(document)
    all_names = sorted(set().union(*map(set, evaluation['groups'].values())))
    values, fits, seen = {}, set(), {}
    for name in all_names:
        value = encode_name(loaded, name)
        canonical = name.lower()
        assert decode_name(loaded, value) == (canonical if value >> 62 != 3 else f'#{value:016x}')
        assert encode_name(loaded, decode_name(loaded, value)) == value
        if value in seen and seen[value] != canonical:
            raise ValueError(f'Evaluated ID collision: {seen[value]} / {canonical}')
        seen[value] = canonical
        values[name] = str(value)
        if value >> 62 != 3:
            fits.add(name)
    groups = {label: {'names': subset, 'fit_names': sorted(set(subset) & fits),
                       'readable': len(set(subset) & fits)}
              for label, subset in evaluation['groups'].items()}
    source_metrics = {source: {'names': len(subset),
                               'percent': round(100 * len(set(subset) & fits) / len(subset), 2)}
                      for source, subset in evaluation['external_sources'].items()}
    return {'groups': groups, 'external_macro': hierarchical_score(source_metrics, evaluation['source_info']),
            'values': values}


def check_metrics(baseline, previous, current, policy):
    errors = []
    for group in ('core', 'preferred'):
        required = set(baseline['groups'][group]['fit_names']) | set(previous['groups'][group]['fit_names'])
        lost = sorted(required - set(current['groups'][group]['fit_names']))
        if lost:
            errors.append(f'{group} readable regressions: {lost}')
    original, candidate = baseline['external_macro'], current['external_macro']
    if original['balanced_macro_percent'] - candidate['balanced_macro_percent'] > policy['max_external_macro_drop_pp'] + 1e-9:
        errors.append('External macro score exceeds cumulative regression budget')
    for ecosystem, score in original['ecosystem_macro_percent'].items():
        if score - candidate['ecosystem_macro_percent'][ecosystem] > policy['max_ecosystem_drop_pp'] + 1e-9:
            errors.append(f'{ecosystem} exceeds cumulative regression budget')
    old_fits = set(baseline['groups']['external']['fit_names'])
    count = len(baseline['groups']['external']['names'])
    if len(old_fits - set(current['groups']['external']['fit_names'])) / count > policy['max_external_lost_fraction']:
        errors.append('External lost-name count exceeds cumulative regression budget')
    return errors


def change_report(previous, current):
    groups = {}
    for key, group in current['groups'].items():
        before, after = set(previous['groups'][key]['fit_names']), set(group['fit_names'])
        groups[key] = {'names': len(group['names']), 'readable': len(after),
                       'gained': sorted(after - before), 'lost': sorted(before - after)}
    changed = sorted(name for name, value in current['values'].items()
                     if name in previous['values'] and value != previous['values'][name])
    return {'groups': groups, 'external_macro': current['external_macro'],
            'numeric_ids_changed': len(changed), 'numeric_id_changes': changed}


def snapshot_inputs(pack):
    reference_path = HERE / 'results-expanded.json'
    reference = read(reference_path)
    raw = (HERE / 'corpus-expanded.jsonl').read_bytes()
    if sha(raw) != reference['corpus_sha256']:
        raise ValueError('Reference corpus changed')
    records = [json.loads(line) for line in raw.decode().splitlines()]
    probes = read(HERE / 'preferred-names.json')['examples']
    train, _, novel = make_split(records, {row['preferred'].lower() for row in probes})
    weights, mass = hierarchy_weights(train)
    evaluation = {'groups': {'core': sorted({row['method'] for row in codec.local_methods()}),
                              'preferred': sorted(row['preferred'] for row in probes),
                              'external': sorted({row['method'] for row in novel})},
                  'external_sources': {}, 'source_info': reference['source_info']}
    sources = defaultdict(set)
    for row in novel:
        sources[row['source']].add(row['method'])
    evaluation['external_sources'] = {source: sorted(names) for source, names in sorted(sources.items())}
    input_dir = pack / 'inputs'
    input_dir.mkdir()
    (input_dir / 'training.jsonl').write_text(''.join(json.dumps({'name': name, 'weight_hex': value.hex()}, sort_keys=True) + '\n'
                                                   for name, value in sorted(weights.items())))
    write(input_dir / 'evaluation.json', evaluation)
    write(input_dir / 'policy.json', DEFAULT_POLICY)
    write(input_dir / 'provenance.json', {'corpus_sha256': sha(raw), 'reference_results_sha256': sha(reference_path.read_bytes()),
                                         'split': reference['split'], 'source_mass': mass,
                                         'source_metadata_sha256': sha((HERE / 'corpus-expanded-metadata.json').read_bytes()),
                                         'original_corpus_path': '../corpus-expanded.jsonl',
                                         'input_role': 'Exact materialized weights/split; source corpus and licenses remain preserved alongside the bundle'})


def inputs(pack):
    directory = pack / 'inputs'
    weights = {row['name']: float.fromhex(row['weight_hex'])
               for row in (json.loads(line) for line in (directory / 'training.jsonl').read_text().splitlines())}
    return weights, read(directory / 'evaluation.json'), read(directory / 'policy.json')


def revision_path(pack, revision):
    if not re.fullmatch(r'[0-9a-f]{64}', revision):
        raise ValueError('Bad revision identifier')
    return pack / 'revisions' / revision


def verify_revision(pack, revision):
    directory = revision_path(pack, revision)
    manifest = read(directory / 'manifest.json')
    if sha(canonical_json(manifest)) != revision:
        raise ValueError('Revision manifest changed')
    for name, digest in manifest['files'].items():
        if '/' in name or name.startswith('.') or sha((directory / name).read_bytes()) != digest:
            raise ValueError('Revision artifact changed')
    for name, digest in manifest['inputs'].items():
        if '/' in name or name.startswith('.') or sha((pack / 'inputs' / name).read_bytes()) != digest:
            raise ValueError('Saved training inputs or policy changed; initialize a new bundle for intentional baseline changes')
    return directory, manifest


def save_revision(pack, parent, ledger, document, metrics, report, reason):
    folder = pack / 'revisions'
    folder.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(dir=folder) as temporary:
        staging = Path(temporary)
        for name, value in [('weights.json', ledger), ('model.json', document), ('metrics.json', metrics), ('report.json', report)]:
            write(staging / name, value)
        golden = {'format': document['format_version'], 'model_sha256': sha(canonical_json(document)),
                  'vectors': [{'text': name, 'value_u64': value,
                               'decoded': name.lower() if int(value) >> 62 != 3 else f'#{int(value):016x}'}
                              for name, value in sorted(metrics['values'].items())]}
        write(staging / 'golden.json', golden)
        manifest = {'parent': parent, 'reason': reason, 'format': document['format_version'],
                    'model_sha256': sha(canonical_json(document)),
                    'files': {path.name: sha(path.read_bytes()) for path in sorted(staging.iterdir())},
                    'inputs': {path.name: sha(path.read_bytes()) for path in sorted((pack / 'inputs').iterdir())},
                    'trainer_sources': {name: sha((HERE / name).read_bytes()) for name in
                                        ('action_name_training.py', 'action_name_model.py', 'benchmark.py', 'expansion_benchmark.py')}}
        revision = sha(canonical_json(manifest))
        destination = revision_path(pack, revision)
        if not destination.exists():
            destination.mkdir()
            for path in staging.iterdir():
                path.replace(destination / path.name)
            write(destination / 'manifest.json', manifest)
    return revision


@contextmanager
def writer(pack):
    lock = pack / '.writer.lock'
    try:
        handle = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError as error:
        raise ValueError('Another writer is active; inspect stale lock before retrying') from error
    os.close(handle)
    try:
        yield
    finally:
        lock.unlink()


def point_current(pack, revision):
    temporary = pack / '.current.tmp'
    write(temporary, {'revision': revision})
    temporary.replace(pack / 'current.json')


def bootstrap(pack):
    if pack.exists():
        raise ValueError('Bootstrap destination must not exist')
    pack.mkdir(parents=True)
    snapshot_inputs(pack)
    weights, evaluation, _ = inputs(pack)
    document = build_model(weights)
    metrics = evaluate(document, evaluation)
    revision = save_revision(pack, None, {}, document, metrics, change_report(metrics, metrics), 'Initial frozen external-only development baseline')
    point_current(pack, revision)
    write(pack / 'baseline.json', {'revision': revision})
    print(json.dumps({'revision': revision, 'report': change_report(metrics, metrics)['groups'], 'model_sha256': sha(canonical_json(document))}))


def update(pack, request_path, apply):
    with writer(pack):
        assert_development(pack)
        current, previous_manifest = verify_pack(pack)
        previous_dir, _ = verify_revision(pack, current)
        for name, digest in previous_manifest['trainer_sources'].items():
            if sha((HERE / name).read_bytes()) != digest:
                raise ValueError('Trainer sources changed; create and review a new baseline bundle')
        baseline_dir, _ = verify_revision(pack, read(pack / 'baseline.json')['revision'])
        base, evaluation, policy = inputs(pack)
        request = read(request_path)
        if not isinstance(request.get('reason'), str) or not request['reason'].strip():
            raise ValueError('An update reason is required')
        requested = validate_weights(base, read(previous_dir / 'weights.json'), request['weights'], policy)
        reserved = evaluation['groups']['external'] + evaluation['groups']['preferred']
        if {name.lower() for name in requested} & {name.lower() for name in reserved}:
            raise ValueError('Update would train on a frozen evaluation name; create a new explicit split instead')
        document = build_model(merged_weights(base, requested))
        metrics = evaluate(document, evaluation)
        previous = read(previous_dir / 'metrics.json')
        errors = check_metrics(read(baseline_dir / 'metrics.json'), previous, metrics, policy)
        report = change_report(previous, metrics)
        report['policy_errors'] = errors
        loaded = load_model(document)
        report['targets'] = {name: {'readable': encode_name(loaded, name) >> 62 != 3,
                                    'value_u64': str(encode_name(loaded, name)),
                                    'decoded': decode_name(loaded, encode_name(loaded, name))}
                             for name in requested}
        ordinary = sum(base.values()) / len(base)
        extra = ordinary * sum(requested.values())
        report['target_fraction_of_training_mass'] = extra / (sum(base.values()) + extra)
        revision = save_revision(pack, current, requested, document, metrics, report, request['reason'])
        if apply:
            if errors:
                raise ValueError('Candidate saved but not applied: ' + '; '.join(errors))
            point_current(pack, revision)
        print(json.dumps({'revision': revision, 'applied': apply, 'policy_errors': errors,
                          'groups': report['groups'], 'external_macro': metrics['external_macro'],
                          'numeric_ids_changed': report['numeric_ids_changed']}))


def verify_pack(pack):
    revision = read(pack / 'current.json')['revision']
    directory, manifest = verify_revision(pack, revision)
    cursor, seen = revision, set()
    while cursor is not None:
        if cursor in seen:
            raise ValueError('Revision history is cyclic')
        seen.add(cursor)
        root = cursor
        ancestor_dir, ancestor = verify_revision(pack, cursor)
        if read(ancestor_dir / 'report.json').get('policy_errors'):
            raise ValueError('Current history includes a rejected candidate')
        cursor = ancestor['parent']
    if root != read(pack / 'baseline.json')['revision']:
        raise ValueError('Baseline pointer is not the immutable root of the revision chain')
    document = read(directory / 'model.json')
    if sha(canonical_json(document)) != manifest['model_sha256']:
        raise ValueError('Model manifest hash mismatch')
    loaded = load_model(document)
    golden = read(directory / 'golden.json')
    if golden['model_sha256'] != manifest['model_sha256']:
        raise ValueError('Golden model hash mismatch')
    for row in golden['vectors']:
        if encode_name(loaded, row['text']) != int(row['value_u64']) or decode_name(loaded, int(row['value_u64'])) != row['decoded']:
            raise ValueError('Golden vector mismatch')
    base, evaluation, policy = inputs(pack)
    stored_metrics = read(directory / 'metrics.json')
    if canonical_json(evaluate(document, evaluation)) != canonical_json(stored_metrics):
        raise ValueError('Stored metrics do not match the saved model and evaluation corpus')
    parent_dir = revision_path(pack, manifest['parent']) if manifest['parent'] else directory
    previous_metrics = read(parent_dir / 'metrics.json')
    baseline_metrics = read(revision_path(pack, root) / 'metrics.json')
    errors = check_metrics(baseline_metrics, previous_metrics, stored_metrics, policy)
    if errors:
        raise ValueError('Current revision fails policy: ' + '; '.join(errors))
    ledger = read(directory / 'weights.json')
    if manifest['parent']:
        validate_weights(base, read(parent_dir / 'weights.json'), ledger, policy)
    elif ledger:
        raise ValueError('Baseline ledger must be empty')
    reserved = evaluation['groups']['external'] + evaluation['groups']['preferred']
    if {name.lower() for name in ledger} & {name.lower() for name in reserved}:
        raise ValueError('Current ledger trains on a frozen evaluation name')
    if (pack / 'release.lock').exists():
        release = read(pack / 'release.lock')
        if release['revision'] != revision or release['manifest_sha256'] != sha((directory / 'manifest.json').read_bytes()):
            raise ValueError('Release lock changed or points at a different revision')
        if release['conformance_sha256'] != sha((pack / 'release-conformance.json').read_bytes()):
            raise ValueError('Release conformance evidence changed')
        for language, report_hash in release['language_reports'].items():
            if sha((pack / 'release-reports' / (language + '.json')).read_bytes()) != report_hash:
                raise ValueError('Released language report changed')
    return revision, manifest


def freeze(pack, conformance_path):
    with writer(pack):
        assert_development(pack)
        revision, manifest = verify_pack(pack)
        evidence = read(conformance_path)
        if evidence.get('model_sha256') != manifest['model_sha256'] or evidence.get('revision') != revision:
            raise ValueError('Conformance evidence must match the exact model and revision')
        if set(evidence.get('languages', {})) != {'cpp', 'rust', 'javascript'}:
            raise ValueError('Release requires C++, Rust and JavaScript conformance evidence')
        reports = {}
        golden_hash = sha((revision_path(pack, revision) / 'golden.json').read_bytes())
        golden_count = len(read(revision_path(pack, revision) / 'golden.json')['vectors'])
        for language, result in evidence['languages'].items():
            if result.get('passed') is not True or not re.fullmatch(r'[0-9a-f]{64}', result.get('report_sha256', '')):
                raise ValueError(f'{language} conformance is incomplete')
            report_path = conformance_path.parent / result['report_path']
            raw = report_path.read_bytes()
            if sha(raw) != result['report_sha256']:
                raise ValueError(f'{language} report hash mismatch')
            report = json.loads(raw)
            vector_count = report.get('vector_count')
            if (report.get('language') != language or report.get('passed') is not True
                    or report.get('model_sha256') != manifest['model_sha256']
                    or report.get('golden_sha256') != golden_hash
                    or isinstance(vector_count, bool) or not isinstance(vector_count, int) or vector_count < golden_count):
                raise ValueError(f'{language} did not attest the exact full golden corpus')
            required = {'malformed', 'boundaries', 'hash_fallback', 'round_trip', 'duplicate_ids'}
            if any(report.get('checks', {}).get(name) is not True for name in required):
                raise ValueError(f'{language} required conformance checks are incomplete')
            reports[language] = raw
        if evidence.get('release_checklist_complete') is not True:
            raise ValueError('Release checklist is incomplete')
        write(pack / 'release-conformance.json', evidence)
        report_dir = pack / 'release-reports'
        report_dir.mkdir(exist_ok=True)
        for language, raw in reports.items():
            (report_dir / (language + '.json')).write_bytes(raw)
        write(pack / 'release.lock', {'revision': revision, 'model_sha256': manifest['model_sha256'],
                                     'manifest_sha256': sha((revision_path(pack, revision) / 'manifest.json').read_bytes()),
                                     'conformance_sha256': sha((pack / 'release-conformance.json').read_bytes()),
                                     'language_reports': {language: sha(raw) for language, raw in reports.items()}})
        print(json.dumps({'locked': revision, 'model_sha256': manifest['model_sha256']}))


def reproduce(pack):
    revision, manifest = verify_pack(pack)
    base, _, _ = inputs(pack)
    ledger = read(revision_path(pack, revision) / 'weights.json')
    rebuilt = build_model(merged_weights(base, ledger))
    if sha(canonical_json(rebuilt)) != manifest['model_sha256']:
        raise ValueError('Saved training data does not regenerate the frozen model exactly')
    print(json.dumps({'reproduced': revision, 'model_sha256': manifest['model_sha256']}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    sub = parser.add_subparsers(dest='command', required=True)
    for name in ('bootstrap', 'verify', 'reproduce'):
        sub.add_parser(name).add_argument('bundle', type=Path)
    command = sub.add_parser('update')
    command.add_argument('bundle', type=Path)
    command.add_argument('request', type=Path)
    command.add_argument('--apply', action='store_true')
    command = sub.add_parser('freeze')
    command.add_argument('bundle', type=Path)
    command.add_argument('conformance', type=Path)
    args = parser.parse_args()
    try:
        if args.command == 'bootstrap': bootstrap(args.bundle)
        elif args.command == 'update': update(args.bundle, args.request, args.apply)
        elif args.command == 'freeze': freeze(args.bundle, args.conformance)
        elif args.command == 'reproduce': reproduce(args.bundle)
        else: print(json.dumps({'verified': verify_pack(args.bundle)[0]}))
    except (ValueError, KeyError, AssertionError, OSError, TypeError) as error:
        parser.exit(2, str(error) + '\n')


if __name__ == '__main__':
    main()
