#!/usr/bin/env python3
"""Record how long tests take, and on what, so runs can be compared across commits.

    record.py run     --build-dir BUILD --suite NAME [--label TEXT] [-- CTEST_ARGS...]
    record.py import  --ctest-log FILE  --build-dir BUILD --suite NAME [--label TEXT]
    record.py compare OLD.json NEW.json [--threshold PERCENT]
    record.py history TEST_NAME [--suite NAME]

`run` invokes ctest and records every test's status and wall time. `import` records a
ctest log that already exists (the "N/M Test #k: name ... Passed 1.23 sec" lines).
Each run becomes one file under tests/timing/runs/ and is never overwritten: commit it
with the change it measured. A run is only comparable with runs of the same suite on
the same system fingerprint; `compare` says so when they differ.

Nothing identifying the operator is stored: no host name, user name, or paths.
"""
import argparse
import datetime
import hashlib
import json
import os
import platform
import re
import subprocess
import sys
import time
import xml.etree.ElementTree as ElementTree
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
RUNS = Path(__file__).resolve().parent / 'runs'


def sh(*argv, cwd=None):
    try:
        return subprocess.run(argv, cwd=cwd, capture_output=True, text=True, timeout=30).stdout.strip()
    except (OSError, subprocess.SubprocessError):
        return ''


def system():
    info = {'os': platform.system(), 'os_release': platform.release(), 'machine': platform.machine()}
    if info['os'] == 'Darwin':
        info['os_version'] = platform.mac_ver()[0]
        info['cpu'] = sh('sysctl', '-n', 'machdep.cpu.brand_string')
        info['model'] = sh('sysctl', '-n', 'hw.model')
        info['logical_cpus'] = int(sh('sysctl', '-n', 'hw.logicalcpu') or 0)
        info['performance_cores'] = int(sh('sysctl', '-n', 'hw.perflevel0.physicalcpu') or 0)
        info['memory_bytes'] = int(sh('sysctl', '-n', 'hw.memsize') or 0)
    else:
        for line in Path('/proc/cpuinfo').read_text().splitlines() if Path('/proc/cpuinfo').exists() else []:
            if line.startswith('model name'):
                info['cpu'] = line.split(':', 1)[1].strip()
                break
        info['logical_cpus'] = os.cpu_count() or 0
        for line in Path('/proc/meminfo').read_text().splitlines() if Path('/proc/meminfo').exists() else []:
            if line.startswith('MemTotal'):
                info['memory_bytes'] = int(line.split()[1]) * 1024
                break
    return info


def filesystem(path):
    """The filesystem the tests write to: storage tests are dominated by it."""
    if platform.system() == 'Darwin':
        device = sh('df', str(path)).splitlines()[-1].split()[0] if sh('df', str(path)) else ''
        described = sh('diskutil', 'info', device)
        found = {}
        for line in described.splitlines():
            key, _, value = line.partition(':')
            if key.strip() in ('File System Personality', 'Solid State', 'Device / Media Name', 'Protocol'):
                found[key.strip()] = value.strip()
        return {'type': found.get('File System Personality', ''), 'solid_state': found.get('Solid State', ''),
                'protocol': found.get('Protocol', '')}
    fields = sh('df', '-T', str(path)).splitlines()
    return {'type': fields[-1].split()[1] if fields else ''}


def fingerprint(info):
    keys = ('os', 'machine', 'cpu', 'model', 'logical_cpus', 'memory_bytes')
    text = '|'.join(str(info.get(key, '')) for key in keys)
    return hashlib.sha256(text.encode()).hexdigest()[:12]


def build(build_dir):
    cache = {}
    cache_file = build_dir / 'CMakeCache.txt'
    if cache_file.exists():
        for line in cache_file.read_text(errors='replace').splitlines():
            match = re.match(r'^(CMAKE_BUILD_TYPE|CMAKE_CXX_COMPILER|CMAKE_CXX_FLAGS|CMAKE_GENERATOR):[^=]*=(.*)$', line)
            if match:
                cache[match.group(1)] = match.group(2)
    compiler = cache.get('CMAKE_CXX_COMPILER', '')
    version = sh(compiler, '--version').splitlines()[0] if compiler else ''
    return {'type': cache.get('CMAKE_BUILD_TYPE', ''), 'compiler': version,
            'flags': cache.get('CMAKE_CXX_FLAGS', ''), 'generator': cache.get('CMAKE_GENERATOR', '')}


def source():
    pin = ''
    dependencies = ROOT / 'cmake' / 'PsibaseDependencies.cmake'
    if dependencies.exists():
        match = re.search(r'psitri\.git\s+GIT_TAG\s+([0-9a-f]{40})', dependencies.read_text())
        pin = match.group(1) if match else ''
    return {'commit': sh('git', 'rev-parse', 'HEAD', cwd=ROOT),
            'branch': sh('git', 'rev-parse', '--abbrev-ref', 'HEAD', cwd=ROOT),
            'dirty': bool(sh('git', 'status', '--porcelain', '--untracked-files=no', cwd=ROOT)),
            'psitri': pin}


def parse_log(text):
    tests = []
    pattern = re.compile(r'^\s*\d+/\d+ Test\s+#\d+: (\S+) \.*\s*(\*\*\*)?\s*(Passed|Failed|Not Run|Timeout|'
                         r'Exception: [A-Za-z ]+?|Subprocess aborted|Skipped)\S*\s+([0-9.]+) sec', re.M)
    for name, _, status, seconds in pattern.findall(text):
        tests.append({'name': name, 'status': 'passed' if status == 'Passed' else status.lower(),
                      'seconds': float(seconds)})
    return tests


def parse_junit(path):
    tests = []
    for case in ElementTree.parse(path).getroot().iter('testcase'):
        status = case.get('status', '')
        tests.append({'name': case.get('name'),
                      'status': 'passed' if status == 'run' else ('not run' if status == 'notrun' else status),
                      'seconds': float(case.get('time') or 0)})
    return tests


def save(args, tests, wall, ctest_args):
    if not tests:
        raise SystemExit('no test results found; nothing recorded')
    info = system()
    now = datetime.datetime.now(datetime.timezone.utc)
    src = source()
    record = {
        'schema': 1,
        'suite': args.suite,
        'label': args.label or '',
        'recorded': now.strftime('%Y-%m-%dT%H:%M:%SZ'),
        'source': src,
        'system': {**info, 'fingerprint': fingerprint(info), 'test_filesystem': filesystem(args.build_dir)},
        'build': build(args.build_dir),
        'ctest_arguments': ctest_args,
        'wall_seconds': round(wall, 3) if wall is not None else None,
        'summary': {'tests': len(tests), 'passed': sum(t['status'] == 'passed' for t in tests),
                    'test_seconds': round(sum(t['seconds'] for t in tests), 3)},
        'tests': sorted(tests, key=lambda t: t['name']),
    }
    RUNS.mkdir(parents=True, exist_ok=True)
    name = '{}-{}-{}-{}.json'.format(now.strftime('%Y%m%dT%H%M%SZ'), args.suite, src['commit'][:9] or 'nocommit',
                                    record['system']['fingerprint'])
    target = RUNS / name
    if target.exists():
        raise SystemExit(str(target) + ' already exists; runs are never overwritten')
    target.write_text(json.dumps(record, indent=1) + '\n')
    print('recorded {}: {}/{} passed, {:.1f}s of tests{}'.format(
        target.relative_to(ROOT), record['summary']['passed'], len(tests), record['summary']['test_seconds'],
        ' (uncommitted changes)' if src['dirty'] else ''))
    return record


def run(args):
    junit = args.build_dir / 'timing-junit.xml'
    junit.unlink(missing_ok=True)
    argv = ['ctest', '--test-dir', str(args.build_dir), '--output-junit', str(junit)] + args.ctest
    start = time.monotonic()
    result = subprocess.run(argv)
    wall = time.monotonic() - start
    save(args, parse_junit(junit) if junit.exists() else [], wall, args.ctest)
    return result.returncode


def load(path):
    return json.loads(Path(path).read_text())


def compare(args):
    old, new = load(args.old), load(args.new)
    if old['suite'] != new['suite']:
        print('note: different suites ({} vs {})'.format(old['suite'], new['suite']))
    same = old['system']['fingerprint'] == new['system']['fingerprint'] and old['build'] == new['build']
    if not same:
        print('note: different system or build; durations are not directly comparable')
        for key in ('cpu', 'model', 'logical_cpus', 'memory_bytes'):
            if old['system'].get(key) != new['system'].get(key):
                print('  {}: {} -> {}'.format(key, old['system'].get(key), new['system'].get(key)))
        for key in ('type', 'compiler', 'flags'):
            if old['build'].get(key) != new['build'].get(key):
                print('  build {}: {} -> {}'.format(key, old['build'].get(key), new['build'].get(key)))
    print('{} {} -> {} {}'.format(old['source']['commit'][:9], old['recorded'], new['source']['commit'][:9],
                                  new['recorded']))
    before = {t['name']: t for t in old['tests']}
    after = {t['name']: t for t in new['tests']}
    rows, regressions = [], 0
    for name in sorted(set(before) | set(after)):
        a, b = before.get(name), after.get(name)
        if not a or not b:
            rows.append((name, a, b, 'added' if b else 'removed'))
            continue
        if a['status'] != b['status']:
            rows.append((name, a, b, '{} -> {}'.format(a['status'], b['status'])))
            regressions += b['status'] != 'passed'
            continue
        if a['status'] != 'passed':
            continue
        # Sub-100ms tests are scheduling noise at this resolution.
        if max(a['seconds'], b['seconds']) < 0.1:
            continue
        change = (b['seconds'] - a['seconds']) / a['seconds'] * 100 if a['seconds'] else float('inf')
        if abs(change) >= args.threshold:
            rows.append((name, a, b, '{:+.0f}%'.format(change)))
            regressions += change > 0
    for name, a, b, note in rows:
        print('  {:<44} {:>9} {:>9}  {}'.format(name, '{:.2f}s'.format(a['seconds']) if a else '-',
                                              '{:.2f}s'.format(b['seconds']) if b else '-', note))
    print('total test time {:.1f}s -> {:.1f}s; {} test(s) beyond {}%'.format(
        old['summary']['test_seconds'], new['summary']['test_seconds'], len(rows), args.threshold))
    return 1 if regressions and same else 0


def history(args):
    for path in sorted(RUNS.glob('*.json')):
        record = load(path)
        if args.suite and record['suite'] != args.suite:
            continue
        for test in record['tests']:
            if test['name'] == args.test:
                print('{} {} {:<9} {:>8.2f}s {} {}{}'.format(
                    record['recorded'], record['source']['commit'][:9], test['status'], test['seconds'],
                    record['system']['fingerprint'], record['build']['type'],
                    ' dirty' if record['source']['dirty'] else ''))
    return 0


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('run', 'import'):
        command = commands.add_parser(name)
        command.add_argument('--build-dir', required=True, type=Path)
        command.add_argument('--suite', required=True, help='a stable name for this set of tests')
        command.add_argument('--label', help='free text: what was being measured')
        if name == 'import':
            command.add_argument('--ctest-log', required=True, type=Path)
        else:
            command.add_argument('ctest', nargs='*', help='arguments passed to ctest (after --)')
    command = commands.add_parser('compare')
    command.add_argument('old')
    command.add_argument('new')
    command.add_argument('--threshold', type=float, default=20.0, help='report changes of at least this percent')
    command = commands.add_parser('history')
    command.add_argument('test')
    command.add_argument('--suite')
    args = parser.parse_args()
    if args.command == 'run':
        return run(args)
    if args.command == 'import':
        save(args, parse_log(args.ctest_log.read_text(errors='replace')), None, [])
        return 0
    return compare(args) if args.command == 'compare' else history(args)


if __name__ == '__main__':
    sys.exit(main())
