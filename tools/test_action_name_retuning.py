#!/usr/bin/env python3
"""Prove model-only regeneration updates all ports, then restore active inputs.

Runs a saved alternate model and the current model without editing any runtime
consumer source. This development-only test always restores the current model
and generated artifacts, including when an alternate-model test fails.
"""
import hashlib
import json
from pathlib import Path
import subprocess
import sys

ROOT = Path(__file__).resolve().parents[1]
BUNDLE = ROOT / 'experiments/method-names/action-name-training'
MODEL = ROOT / 'libraries/psibase/common/share/action-name-model.json'
BUILD = ROOT / 'build-action-names'


def run(*args):
    subprocess.run([sys.executable, *map(str, args)], cwd=ROOT, check=True)


def main():
    if (BUNDLE / 'release.lock').exists():
        raise SystemExit('Retuning test is development-only; shipping bundle is locked')
    consumers = [ROOT / path for path in (
        'libraries/psio/include/psio/action_name.hpp',
        'rust/psibase_names/src/action_name.rs',
        'packages/user/CommonApi/common/packages/common-lib/src/action-name.ts')]
    before = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in consumers}
    original = MODEL.read_bytes()
    baseline = json.loads((BUNDLE / 'baseline.json').read_text())['revision']
    alternate = (BUNDLE / 'revisions' / baseline / 'model.json').read_bytes()
    if json.loads(original) == json.loads(alternate):
        raise SystemExit('Select a distinct saved baseline model before the retuning test')
    BUILD.mkdir(exist_ok=True)
    try:
        MODEL.write_bytes(alternate)
        run('tools/action_names.py', 'generate')
        run('tools/test_action_names.py', '--output', BUILD / 'retuned-conformance.json')
    finally:
        MODEL.write_bytes(original)
        run('tools/action_names.py', 'generate')
    run('tools/test_action_names.py', '--output', BUILD / 'conformance.json')
    after = {str(path.relative_to(ROOT)): hashlib.sha256(path.read_bytes()).hexdigest() for path in consumers}
    if before != after:
        raise AssertionError('Retuning changed runtime consumer source')
    reports = [json.loads((BUILD / name).read_text()) for name in ('retuned-conformance.json', 'conformance.json')]
    result = {'passed': True, 'model_sha256': [row['model_sha256'] for row in reports],
              'runtime_sources_unchanged': before, 'all_ports_identical_for_both_models': True,
              'current_model_restored': MODEL.read_bytes() == original,
              'vectors_per_model': [row['vectors'] for row in reports]}
    (BUILD / 'retuning.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result, indent=2))


if __name__ == '__main__':
    main()
