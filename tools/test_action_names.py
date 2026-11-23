#!/usr/bin/env python3
"""Build independent C++/Rust/JS ports and compare full IDs and strict decoding.

Run `corepack yarn install --immutable` from packages/ before the first run.
The report is machine-readable release evidence; Python reference validation
and standalone codec checks do not replace service integration tests.
"""
import argparse
import hashlib
import json
import os
from pathlib import Path
import random
import shlex
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BUILD = ROOT / 'build-action-names'
COMMON = ROOT / 'packages/user/CommonApi/common/packages/common-lib'
VECTORS = ROOT / 'libraries/psibase/common/share/action-name-vectors.json'
sys.path.insert(0, str(ROOT / 'experiments/method-names'))
from action_name_model import load_model, encode_name, decode_name


def run(command, *, data=None, cwd=ROOT):
    result = subprocess.run(list(map(str, command)), input=data, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, cwd=cwd)
    if result.returncode:
        raise RuntimeError(f'Command failed ({result.returncode}): {command}\n{result.stdout[-4000:]}\n{result.stderr[-4000:]}')
    return result.stdout


def build():
    BUILD.mkdir(exist_ok=True)
    run(shlex.split(os.environ.get('CXX', 'c++')) + ['-std=c++23', '-O2', '-I', ROOT / 'libraries/psio/include',
        ROOT / 'libraries/psibase/common/tests/action_name_probe.cpp', '-o', BUILD / 'cpp-probe'])
    compiler = shlex.split(os.environ.get('CXX', 'c++'))
    extra_includes = []
    for path in (Path('/opt/homebrew/include'), Path('/usr/local/include')):
        if (path / 'boost/core/demangle.hpp').exists():
            extra_includes += ['-I', str(path)]
    run(compiler + ['-std=c++23', '-O2', '-I', ROOT / 'libraries/psio/include',
                   '-I', ROOT / 'libraries/psibase/common/include', '-c',
                   ROOT / 'libraries/psibase/common/tests/action_name_constexpr.cpp',
                   '-o', BUILD / 'constexpr.o'])
    duplicate = subprocess.run(compiler + extra_includes + ['-std=c++23', '-fsyntax-only', '-I', str(ROOT / 'libraries/psio/include'),
                                str(ROOT / 'libraries/psibase/common/tests/action_name_duplicate.cpp')],
                               capture_output=True, text=True)
    if duplicate.returncode == 0 or 'Duplicate encoded reflected method name' not in duplicate.stderr:
        raise AssertionError('C++ duplicate-ID diagnostic did not reject the fixture:\n' + duplicate.stderr[-3000:])
    run(['cargo', 'build', '--release', '--manifest-path', ROOT / 'rust/Cargo.toml', '-p', 'psibase_names',
         '--example', 'action_name_probe', '--target-dir', BUILD / 'rust'])
    run(['yarn', 'build:action-name-test'], cwd=COMMON)


def rows(command, values, decode=False, javascript=False):
    text = run(command + (['--decode'] if decode else []), data='\n'.join(values) + '\n')
    output = text.splitlines()
    if len(output) != len(values):
        raise AssertionError(f'Probe returned {len(output)} rows for {len(values)} inputs: {command}')
    parsed = []
    for supplied, line in zip(values, output):
        fields = line.split('\t')
        if fields[0] != supplied:
            raise AssertionError(f'Probe input mismatch: {supplied!r} / {line!r}')
        if len(fields) < 2 or fields[1] in ('ERROR', 'INVALID'):
            parsed.append(None)
        elif decode:
            parsed.append(fields[2] if javascript else fields[1])
        else:
            parsed.append((int(fields[1]), fields[2]))
    return parsed


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--skip-build', action='store_true')
    parser.add_argument('--output', type=Path, default=BUILD / 'conformance.json')
    args = parser.parse_args()
    run([sys.executable, ROOT / 'tools/action_names.py', 'check'])
    if not args.skip_build:
        build()
    commands = {
        'cpp': [str(BUILD / 'cpp-probe')],
        'rust': [str(BUILD / 'rust/release/examples/action_name_probe')],
        'javascript': ['node', str(COMMON / 'test/action-name-probe.mjs')],
    }
    data = json.loads(VECTORS.read_text())
    model = load_model(json.loads((ROOT / 'libraries/psibase/common/share/action-name-model.json').read_text()))
    vectors = data['vectors']
    names = [row['text'] for row in vectors]
    expected = [(int(row['value_u64']), row['decoded']) for row in vectors]
    ids = [str(row[0]) for row in expected]
    # Exercise valid IDs, all mode boundaries and adversarial arbitrary IDs.
    rng = random.Random(0xA6710)
    raw = sorted(set([0, 1, (1 << 64) - 1] + [max(0, (mode << 62) + delta)
                for mode in range(4) for delta in (-1, 0, 1)] + [rng.getrandbits(64) for _ in range(4096)]))
    raw_expected = []
    for value in raw:
        try:
            raw_expected.append(decode_name(model, value))
        except ValueError:
            raw_expected.append(None)
    reports = {}
    bundle = ROOT / 'experiments/method-names/action-name-training'
    revision = json.loads((bundle / 'current.json').read_text())['revision']
    bundle_golden_path = bundle / 'revisions' / revision / 'golden.json'
    bundle_golden = json.loads(bundle_golden_path.read_text())
    if bundle_golden['model_sha256'] == data['model_sha256']:
        actual_vectors = {row['text']: (row['value_u64'], row['decoded']) for row in vectors}
        for row in bundle_golden['vectors']:
            if actual_vectors.get(row['text']) != (row['value_u64'], row['decoded']):
                raise AssertionError('Native test corpus omits or changes a saved training golden')
        evidence_golden = bundle_golden_path
    else:
        evidence_golden = VECTORS  # Deliberate alternate-model retuning experiment.
    for language, command in commands.items():
        model_hash = run(command + ['--model-hash']).strip()
        if model_hash != data['model_sha256']:
            raise AssertionError(f'{language} loaded wrong model: {model_hash}')
        actual = rows(command, names)
        for name, want, got in zip(names, expected, actual):
            if want != got:
                raise AssertionError(f'{language} encode {name!r}: expected {want}, got {got}')
        decoded = rows(command, ids, True, language == 'javascript')
        if decoded != [row[1] for row in expected]:
            raise AssertionError(f'{language} valid-ID decode mismatch')
        round_trips = rows(command, [row[1] for row in expected])
        if round_trips != expected:
            raise AssertionError(f'{language} canonical re-encoding mismatch')
        invalid = rows(command, data['invalid_names'])
        if any(row is not None for row in invalid):
            raise AssertionError(f'{language} accepted invalid name')
        invalid_ids = rows(command, data['invalid_u64_decimal'], True, language == 'javascript')
        if any(row is not None for row in invalid_ids):
            raise AssertionError(f'{language} accepted invalid ID')
        decoded_random = rows(command, list(map(str, raw)), True, language == 'javascript')
        for value, want, got in zip(raw, raw_expected, decoded_random):
            if want != got:
                raise AssertionError(f'{language} arbitrary ID {value}: expected {want!r}, got {got!r}')
        reports[language] = {'language': language, 'passed': True, 'model_sha256': model_hash,
                             'golden_sha256': hashlib.sha256(evidence_golden.read_bytes()).hexdigest(),
                             'runtime_golden_sha256': hashlib.sha256(VECTORS.read_bytes()).hexdigest(),
                             'vector_count': len(vectors), 'arbitrary_ids': len(raw),
                             'checks': {'round_trip': True, 'malformed': True, 'boundaries': True,
                                        'hash_fallback': True, 'duplicate_ids': True}}
        print(f'{language}: {len(vectors)} exact ID/round-trip vectors; {len(raw)} arbitrary IDs passed', flush=True)
    # Duplicate canonical identities may share IDs; distinct canonical names may not.
    seen = {}
    for name, (number, decoded) in zip(names, expected):
        canonical = name.lower()
        if canonical.startswith('#'):
            continue
        if number in seen and seen[number] != canonical:
            raise AssertionError(f'Collision: {seen[number]} / {canonical}')
        seen[number] = canonical
    args.output.parent.mkdir(parents=True, exist_ok=True)
    output = {'passed': True, 'model_sha256': data['model_sha256'], 'vectors': len(vectors),
              'arbitrary_ids': len(raw), 'languages': reports}
    args.output.write_text(json.dumps(output, indent=2) + '\n')
    for language, report in reports.items():
        (args.output.parent / (language + '.json')).write_text(json.dumps(report, indent=2) + '\n')
    print('Saved', args.output)


if __name__ == '__main__':
    main()
