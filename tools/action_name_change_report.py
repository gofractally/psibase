#!/usr/bin/env python3
"""Report actual diff lines separately from generated tables/training data.

Stage new files first. Counts are physical added/deleted lines by file category;
Rust runtime files can contain inline tests. No generated data is counted as
handwritten implementation. This command never modifies the Git index.
"""
import argparse
from collections import defaultdict
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
BASE = '44c57f739e20928daf9d020b79d2c9b1d9dd10a9'


def category(path):
    if ('.generated.' in path or path.endswith('action_name_data.hpp')
            or '/common/share/action-name-' in path or path == 'tools/action_names.generated.json'):
        return 'generated_model_and_vectors'
    if path.startswith('experiments/'):
        return 'saved_training_and_research'
    if path.endswith('Cargo.lock') or path.endswith('yarn.lock'):
        return 'dependency_locks'
    if path.startswith('docs/action-names/') and path.endswith('.json'):
        return 'validation_evidence'
    if path.startswith('doc/') or path.endswith('.md'):
        return 'documentation'
    if path.startswith('tools/') or '/tests/' in path or '/test/' in path:
        return 'dedicated_tests_and_tools'
    if path.endswith(('.hpp', '.cpp', '.rs', '.ts', '.wit', '.py')):
        return 'runtime_api_files_including_inline_tests'
    return 'build_and_package_configuration'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--base', default=BASE)
    parser.add_argument('--output', type=Path)
    args = parser.parse_args()
    text = subprocess.check_output(['git', 'diff', '--numstat', args.base], cwd=ROOT, text=True)
    totals = defaultdict(lambda: {'files': 0, 'added': 0, 'deleted': 0})
    files = []
    for line in text.splitlines():
        added, deleted, path = line.split('\t', 2)
        if path == 'docs/action-names/change-report.json':
            continue  # The report must not count its own changing serialization.
        group = category(path)
        row = {'path': path, 'category': group, 'added': int(added) if added != '-' else 0,
               'deleted': int(deleted) if deleted != '-' else 0}
        files.append(row)
        totals[group]['files'] += 1
        totals[group]['added'] += row['added']
        totals[group]['deleted'] += row['deleted']
    result = {'base': args.base, 'counting': 'Physical diff lines; new files must be staged; inline tests stay with their runtime file',
              'categories': dict(sorted(totals.items())), 'files': files}
    raw = json.dumps(result, indent=2) + '\n'
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(raw)
    print(json.dumps(result['categories'], indent=2))


if __name__ == '__main__':
    main()
