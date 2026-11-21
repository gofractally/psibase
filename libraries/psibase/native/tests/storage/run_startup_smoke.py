#!/usr/bin/env python3
"""Bounded fresh-directory startup/restart; packages must be qualified separately."""
import argparse
import datetime
import http.client
import json
import platform
from pathlib import Path
import socket
import subprocess
import tempfile
import time

p = argparse.ArgumentParser()
p.add_argument('--node', required=True, type=Path)
p.add_argument('--evidence', required=True, type=Path)
p.add_argument('--package-manifest', required=True, type=Path)
a = p.parse_args()
evidence = a.evidence / datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
evidence.mkdir(parents=True, exist_ok=False)
report = {'scope': 'Fresh native storage startup/restart using the explicitly supplied builtin package manifest; not merged app qualification',
          'package_manifest': str(a.package_manifest), 'runs': [], 'passed': False}

class UnixHTTP(http.client.HTTPConnection):
    def __init__(self, path):
        super().__init__('x-admin.psibase.localhost', timeout=1)
        self.path = str(path)

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.path)

def request(path, method, target, body=None):
    connection = UnixHTTP(path)
    try:
        connection.request(method, target, body=body,
                           headers={'Host': 'x-admin.psibase.localhost', 'Content-Type': 'application/json'})
        response = connection.getresponse()
        return response.status, response.read().decode()
    finally:
        connection.close()

try:
    with tempfile.TemporaryDirectory(prefix='psitri-node-', dir='/tmp') as temporary:
        base = Path(temporary)
        database = base / 'node'
        database.mkdir()
        (base / 'home').mkdir()
        (base / 'tmp').mkdir()
        sentinel = database / 'preserved-log.txt'
        sentinel.write_text('unrelated node log\n')
        config = database / 'config'
        config.write_text('database-cache-policy = disabled\np2p = off\nhost = psibase.localhost\n\n'
                          '[logger.stderr]\ntype = console\nfilter = Severity >= warning\n'
                          'format = [{Severity}] {Message}\n')
        config_bytes = config.read_bytes()
        environment = {'PATH': '/usr/bin:/bin', 'HOME': str(base / 'home'), 'TMPDIR': str(base / 'tmp'),
                       'LANG': 'C', 'LC_ALL': 'C', 'TZ': 'UTC'}
        for index in range(2):
            argv = [str(a.node.resolve()), str(database), '--listen', str(base / 'socket')]
            result = {'argv': argv, 'environment': sorted(environment), 'ready': False}
            report['runs'].append(result)
            with (evidence / f'node-{index}.stdout').open('w') as stdout, (evidence / f'node-{index}.stderr').open('w') as stderr:
                process = subprocess.Popen(argv, env=environment, stdout=stdout, stderr=stderr)
                try:
                    deadline = time.monotonic() + 20
                    while time.monotonic() < deadline and process.poll() is None:
                        try:
                            status, body = request(base / 'socket', 'GET', '/native/admin/status')
                            result['last_status'] = status
                            if status == 200:
                                result['status'] = json.loads(body)
                                result['ready'] = True
                                break
                        except (OSError, http.client.HTTPException):
                            pass
                        time.sleep(0.1)
                    if not result['ready']:
                        raise RuntimeError('node did not become ready')
                    status, body = request(base / 'socket', 'GET', '/native/admin/perf')
                    result['perf_status'] = status
                    if status != 200:
                        raise RuntimeError('performance endpoint failed')
                    perf = json.loads(body)
                    if platform.system() == 'Darwin' and (perf['memory'] is not None or perf['tasks'] is not None):
                        raise RuntimeError('unsupported platform statistics must be null')
                    (evidence / f'node-{index}.perf.json').write_text(body)
                    metrics_status, metrics = request(base / 'socket', 'GET', '/native/admin/metrics')
                    if metrics_status != 200:
                        raise RuntimeError('metrics endpoint failed')
                    (evidence / f'node-{index}.metrics.txt').write_text(metrics)
                    if platform.system() == 'Darwin' and ('psinode_memory_bytes{' in metrics or 'psinode_cpu_user_seconds_total{' in metrics):
                        raise RuntimeError('unsupported metrics must be absent')
                    try:
                        result['shutdown_status'], _ = request(base / 'socket', 'POST', '/shutdown', '{"force":false}')
                    except http.client.RemoteDisconnected:
                        result['shutdown_connection_closed'] = True
                    result['exit_code'] = process.wait(timeout=15)
                    if result['exit_code']:
                        raise RuntimeError('node shutdown failed')
                finally:
                    if process.poll() is None:
                        process.kill()
                        process.wait()
                    result['exit_code'] = process.returncode
                result['native_identity'] = (database / 'state' / 'psibase-storage-format').is_file()
                result['sentinel_unchanged'] = sentinel.read_text() == 'unrelated node log\n'
                result['config_unchanged'] = config.read_bytes() == config_bytes
                if not all(result[name] for name in ['native_identity', 'sentinel_unchanged', 'config_unchanged']):
                    raise RuntimeError('node directory contract failed')
        report['passed'] = True
except Exception as error:
    report['error'] = str(error)
finally:
    (evidence / 'results.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps({'evidence': str(evidence), 'passed': report['passed'], 'error': report.get('error')}))
raise SystemExit(0 if report['passed'] else 1)
