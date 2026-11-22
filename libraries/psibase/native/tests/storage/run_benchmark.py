#!/usr/bin/env python3
"""Retain a reproducible direct-engine versus owner-thread facade microbenchmark."""
import argparse
import datetime
import hashlib
import json
from pathlib import Path
import platform
import os
import shutil
import statistics
import subprocess
import time

p = argparse.ArgumentParser()
p.add_argument('--cc', required=True)
p.add_argument('--cxx', required=True)
p.add_argument('--build-dir', default='build-storage-performance')
p.add_argument('--jobs', default='4')
a = p.parse_args()
root = Path(__file__).resolve().parents[5]
build = root / a.build_dir
evidence = build / 'evidence' / datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
evidence.mkdir(parents=True, exist_ok=False)
report = {'platform': platform.platform(), 'machine': platform.machine(), 'commands': [],
          'free_bytes_before': shutil.disk_usage(root).free, 'source_sha256': {},
          'scope': 'Serial warm 10000-record point reads/updates, 128-byte values, one fsync commit; not an application throughput or cache qualification.',
          'passed': False}
report['host_load_at_start'] = list(os.getloadavg())
report['host_context'] = 'Shared host; concurrent builds may run. Relative matched microbenchmark, no idle-host absolute-performance claim.'
report['compiler_optimization'] = 'CMake Release; no extra ISA tuning or LTO in this standalone fixture'
for relative in ['cmake/psitri.cmake', 'libraries/psibase/native/tests/storage',
                 'cmake/dependencies', 'libraries/psibase/native/src/psitriStorage.cpp',
                 'libraries/psibase/native/src/Watchdog.cpp']:
    path = root / relative
    for source in sorted(path.rglob('*')) if path.is_dir() else [path]:
        if source.is_file():
            report['source_sha256'][str(source.relative_to(root))] = hashlib.sha256(source.read_bytes()).hexdigest()
for name in ['storage.hpp', 'CpuAccounting.hpp', 'NativeThreadClock.hpp', 'DarwinCpuClock.hpp',
             'DarwinWatchdogWake.hpp', 'Watchdog.hpp']:
    source = root / 'libraries/psibase/native/include/psibase' / name
    report['source_sha256'][str(source.relative_to(root))] = hashlib.sha256(source.read_bytes()).hexdigest()

def save():
    (evidence / 'results.json').write_text(json.dumps(report, indent=2) + '\n')

def run(name, argv):
    print(name, flush=True)
    start = time.monotonic()
    result = subprocess.run(list(map(str, argv)), cwd=root, capture_output=True, text=True, timeout=900)
    (evidence / (name + '.stdout')).write_text(result.stdout)
    (evidence / (name + '.stderr')).write_text(result.stderr)
    report['commands'].append({'name': name, 'argv': list(map(str, argv)),
                               'exit_code': result.returncode, 'seconds': time.monotonic() - start})
    save()
    if result.returncode:
        raise RuntimeError(name + ' failed')
    return result

try:
    if report['free_bytes_before'] < 15 * 1024**3:
        raise RuntimeError('less than 15GiB free; no build started')
    run('compiler', [a.cxx, '--version'])
    if platform.system() == 'Linux':
        run('hardware', ['lscpu'])
    elif platform.system() == 'Darwin':
        run('hardware', ['sysctl', 'machdep.cpu.brand_string', 'hw.memsize', 'hw.ncpu'])
    run('configure', ['cmake', '-S', 'libraries/psibase/native/tests/storage', '-B', build, '-G', 'Ninja',
                      '-DCMAKE_BUILD_TYPE=Release', '-DCMAKE_C_COMPILER=' + a.cc,
                      '-DCMAKE_CXX_COMPILER=' + a.cxx,
                      '-DFETCHCONTENT_SOURCE_DIR_PSIBASE_PSITRI=' + str(root / '.caches/psitri-sources/psitri'),
                      '-DFETCHCONTENT_SOURCE_DIR_PSIBASE_UCC=' + str(root / '.caches/psitri-sources/ucc')])
    run('build', ['cmake', '--build', build, '--target', 'storage_benchmark', '--parallel', a.jobs])
    report['host_load_before_benchmark'] = list(os.getloadavg())
    data = json.loads(run('benchmark', [build / 'storage_benchmark', build / 'benchmark-database']).stdout)
    report['host_load_after_benchmark'] = list(os.getloadavg())
    report['measurements'] = data
    kinds = ['direct_read', 'facade_read', 'direct_write', 'facade_write']
    report['median_nanoseconds_per_operation'] = {
        kind: statistics.median(row[kind + '_wall_ns'] for row in data['rounds']) /
              data['reads_per_round' if kind.endswith('read') else 'updates_per_round']
        for kind in kinds}
    report['binary_sha256'] = hashlib.sha256((build / 'storage_benchmark').read_bytes()).hexdigest()
    report['passed'] = True
except Exception as error:
    report['error'] = str(error)
finally:
    report['free_bytes_after'] = shutil.disk_usage(root).free
    save()
print(json.dumps({'evidence': str(evidence), 'passed': report['passed'], 'error': report.get('error')}))
raise SystemExit(0 if report['passed'] else 1)
