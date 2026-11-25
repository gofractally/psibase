#!/usr/bin/env python3
"""Qualify native integration in an already configured full psibase build."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import platform
import subprocess
import tempfile
import time

p = argparse.ArgumentParser()
p.add_argument('--build-dir', default='build-native-psitri')
p.add_argument('--jobs', default='4')
p.add_argument('--watchdog-repetitions', type=int, default=3)
a = p.parse_args()
root = Path(__file__).resolve().parents[5]
build = root / a.build_dir
evidence = build / 'evidence' / datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
evidence.mkdir(parents=True, exist_ok=False)
report = {'platform': platform.platform(), 'commands': [], 'source_sha256': {}, 'passed': False}
sources = ['cmake/PsibaseDependencies.cmake', 'cmake/PsibaseDependencyValidation.cmake',
           'cmake/ucc.cmake', 'cmake/psitri.cmake',
           'cmake/dependencies/ucc-files.sha256', 'cmake/dependencies/psitri-files.sha256',
           'programs/psinode/main.cpp', 'programs/psinode/config.in',
           'libraries/psibase/native/include/psibase/storage.hpp',
           'libraries/psibase/native/include/psibase/storageDiagnostics.hpp',
           'libraries/psibase/native/include/psibase/db.hpp',
           'libraries/psibase/native/src/psitriStorage.cpp',
           'libraries/psibase/native/src/usePsitri.cpp',
           'libraries/psibase/native/src/Watchdog.cpp',
           'libraries/psibase/native/tests/WatchdogTests.cpp',
           'libraries/psibase/native/tests/PsitriDatabaseTests.cpp']
sources += ['libraries/psibase/native/include/psibase/' + name for name in
            ['CpuAccounting.hpp', 'Watchdog.hpp']]
for relative in sources:
    report['source_sha256'][relative] = hashlib.sha256((root / relative).read_bytes()).hexdigest()

def save():
    (evidence / 'results.json').write_text(json.dumps(report, indent=2) + '\n')

def run(name, argv, expected=0):
    print(name, flush=True)
    start = time.monotonic()
    result = subprocess.run(list(map(str, argv)), cwd=root, capture_output=True, text=True, timeout=900)
    (evidence / (name + '.stdout')).write_text(result.stdout)
    (evidence / (name + '.stderr')).write_text(result.stderr)
    report['commands'].append({'name': name, 'argv': list(map(str, argv)), 'exit_code': result.returncode,
                               'expected_exit_code': expected, 'seconds': time.monotonic() - start})
    save()
    if result.returncode != expected:
        raise RuntimeError(name + ' failed')
    return result

def native_test(name):
    choices = [build / relative / name for relative in
               ['native/libraries/psibase/native/tests', 'libraries/psibase/native/tests']]
    present = [path for path in choices if path.is_file()]
    if len(present) != 1:
        raise RuntimeError('Expected one native test binary for ' + name)
    return present[0]

try:
    targets = ['WatchdogTests', 'PsitriDatabaseTests', 'psinode', 'psitest']
    run('build', ['cmake', '--build', build, '--target', *targets, '--parallel', a.jobs])
    for i in range(a.watchdog_repetitions):
        run('watchdog-' + str(i), [native_test('WatchdogTests')])
    run('database', [native_test('PsitriDatabaseTests')])
    node = build / 'psinode'
    help = run('config-help', [node, '--help'], expected=1)
    if '--database-cache-policy' not in help.stderr or '--database-cache-size' in help.stderr:
        raise RuntimeError('node advertises incorrect storage configuration')
    for name, args, diagnostic in [
        ('legacy-cache-rejected', ['--database-cache-size', '256MiB'],
         'replace it with database-cache-policy=disabled'),
        ('unknown-policy-rejected', ['--database-cache-policy', 'unqualified'],
         'Unsupported database-cache-policy')]:
        with tempfile.TemporaryDirectory(prefix='storage-config-', dir=evidence) as directory:
            result = run(name, [node, directory, *args], expected=1)
            if diagnostic not in result.stderr or list(Path(directory).iterdir()):
                raise RuntimeError(name + ' diagnostic or no-write guarantee failed')
    report['binary_sha256'] = {name: hashlib.sha256(path.read_bytes()).hexdigest() for name, path in
                              [('psinode', node), ('psitest', build / 'psitest'),
                               ('WatchdogTests', native_test('WatchdogTests')),
                               ('PsitriDatabaseTests', native_test('PsitriDatabaseTests'))]}
    report['passed'] = True
except Exception as error:
    report['error'] = str(error)
finally:
    save()
print(json.dumps({'evidence': str(evidence), 'passed': report['passed'], 'error': report.get('error')}))
raise SystemExit(0 if report['passed'] else 1)
