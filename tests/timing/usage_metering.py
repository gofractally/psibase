#!/usr/bin/env python3
"""Throughput and latency of one psinode with usage metering on and off.

    python3 tests/timing/usage_metering.py --build-dir <build directory>

That is the whole command. It needs a finished build (psinode, the psibase
CLI and the packages) and a Python with the psinode tests' requirements
(programs/psinode/tests/requirements.txt); if the build was configured with
-DPython_EXECUTABLE the script re-runs itself under that interpreter. It
builds the load generator (rust/psibase-load) into <build>/rust if it is
not there yet.

What it does, M times (--rounds), alternating the two modes so that drift
of the machine affects both alike:

  1. starts a fresh single-producer psinode in a temporary directory,
     listening on a loopback TCP port, with `usage-metering` on or off;
  2. boots a chain (Minimal, Explorer, TokenUsers), gives `alice` a real
     key and tokens, and logs her in;
  3. runs psibase-load against it: signed transfers alice -> bob pushed
     anonymously, the same pushed with alice's login token, and a GET-only
     run of /common/tapos/head;
  4. stops the node.

A fresh node per run, not one node restarted: every run then starts from
the same chain state, the same empty usage table and the same empty pending
transaction tables, so a run cannot inherit anything from the mode before
it. The cost is a boot per run (tens of seconds).

It prints one line per run (the load generator's JSON, with the mode and
the load average added), then per-mode medians and the on/off ratio.
Loopback is a trusted proxy for metering, so the anonymous load is sent
with X-Forwarded-For and is charged to that address, as a client behind a
local reverse proxy would be.

Refs gofractally/psibase#2270.
"""

import argparse
import json
import os
import shutil
import socket
import statistics
import subprocess
import sys
import tempfile
import time

SOURCE_DIR = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))


def read_cache(build_dir):
    values = {}
    try:
        with open(os.path.join(build_dir, 'CMakeCache.txt')) as f:
            for line in f:
                if '=' in line and not line.startswith(('#', '/')):
                    key, value = line.rstrip('\n').split('=', 1)
                    values[key.split(':')[0]] = value
    except FileNotFoundError:
        pass
    return values


def parse_args():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--build-dir', required=True, help='The CMake build directory')
    parser.add_argument('--rounds', type=int, default=5, help='Runs per mode (default 5)')
    parser.add_argument('--transactions', type=int, default=4000, help='Transfers per push run (default 4000)')
    parser.add_argument('--gets', type=int, default=20000, help='Requests per GET run (default 20000)')
    parser.add_argument('--connections', type=int, default=256, help='Keep-alive connections for pushes (default 256)')
    parser.add_argument('--get-connections', type=int, default=16, help='Keep-alive connections for GETs (default 16)')
    parser.add_argument('--rate', type=float, default=0, help='Offered pushes per second; 0 = as fast as accepted')
    parser.add_argument('--keep', action='store_true', help='Keep the node directories')
    return parser.parse_args()


def free_port():
    with socket.socket() as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


def main():
    args = parse_args()
    build = os.path.abspath(args.build_dir)
    cache = read_cache(build)

    # The harness needs requests, cryptography, ... and PSIO's Python package
    python = cache.get('Python_EXECUTABLE')
    try:
        import requests  # noqa: F401
        import cryptography  # noqa: F401
    except ImportError:
        if python and os.path.realpath(python) != os.path.realpath(sys.executable) and not os.environ.get('USAGE_BENCH_REEXEC'):
            os.environ['USAGE_BENCH_REEXEC'] = '1'
            os.execv(python, [python] + sys.argv)
        raise
    psio = cache.get('PSIBASE_PSIO_SOURCE_DIR') or os.path.join(SOURCE_DIR, 'external', 'psio')
    sys.path.insert(0, os.path.join(psio, 'python', 'src'))
    sys.path.insert(0, os.path.join(SOURCE_DIR, 'programs', 'psinode', 'tests'))
    os.environ['PATH'] = build + os.pathsep + os.path.join(build, 'rust', 'release') + os.pathsep + os.environ['PATH']

    from psinode import Node, PrivateKey
    from predicates import new_block
    from services import AuthSig, Transact

    psinode = os.path.join(build, 'psinode')
    tool = os.path.join(build, 'rust', 'release', 'psibase-load')
    if not os.path.exists(tool):
        print('building psibase-load ...', file=sys.stderr, flush=True)
        subprocess.run(['cargo', 'build', '-r', '--bin', 'psibase-load',
                        '--manifest-path', os.path.join(SOURCE_DIR, 'rust', 'Cargo.toml'),
                        '--target-dir', os.path.join(build, 'rust')], check=True)

    faucet = {"token_id": 1, "creditor": "faucet-tok", "amount": {"value": 1000000000}, "memo": ""}
    work = tempfile.mkdtemp(prefix='usage-metering-')

    def load(port, label, extra):
        command = [tool, '-a', 'http://psibase.localhost:%d/' % port, '--connect', '127.0.0.1:%d' % port,
                   '--label', label] + extra
        out = subprocess.run(command, check=True, stdout=subprocess.PIPE, text=True).stdout
        return json.loads(out.strip().splitlines()[-1])

    def run(mode, index):
        directory = os.path.join(work, '%s-%d' % (mode, index))
        port = free_port()
        node = Node(executable=psinode, dir=directory, hostname='psibase.localhost', producer='prod',
                    p2p=False, listen=['127.0.0.1:%d' % port], start=False)
        with open(os.path.join(directory, 'config')) as f:
            text = f.read()
        # The harness's test default (flush every second) is replaced by
        # psinode's own default.
        text = text.replace('usage-flush-interval = 1\n', '')
        with open(os.path.join(directory, 'config'), 'w') as f:
            f.write(('usage-metering = off\n' if mode == 'off' else '') + text)
        node.start()
        results = []
        try:
            node.boot(packages=['Minimal', 'Explorer', 'TokenUsers'])
            node.push_action('alice', 'tokens', 'debit', faucet)
            node.wait(new_block())
            key = PrivateKey()
            AuthSig(node).set_key('alice', key)
            node.wait(new_block())
            keyfile = os.path.join(directory, 'alice.pem')
            with open(keyfile, 'w') as f:
                f.write(key.pkcs8())
            token = Transact(node).login('alice', keys=[key])
            push = ['--mode', 'push', '-n', str(args.transactions), '-c', str(args.connections),
                    '--rate', str(args.rate), '--from', 'alice', '--to', 'bob', '--sign', keyfile]
            results.append(load(port, 'push-anonymous', push + ['-H', 'X-Forwarded-For: 198.51.100.7']))
            results.append(load(port, 'push-account', push + ['--token', token]))
            results.append(load(port, 'get', ['--mode', 'get', '-n', str(args.gets), '-c', str(args.get_connections),
                                              '-H', 'X-Forwarded-For: 198.51.100.7']))
        finally:
            node.shutdown()
            if not args.keep:
                shutil.rmtree(directory, ignore_errors=True)
        for result in results:
            result['metering'] = mode
            result['round'] = index
            result['load_average'] = os.getloadavg()[0]
            print(json.dumps(result), flush=True)
        return results

    all_results = {'on': [], 'off': []}
    for index in range(args.rounds):
        for mode in ['on', 'off'] if index % 2 == 0 else ['off', 'on']:
            all_results[mode].extend(run(mode, index))
    if not args.keep:
        shutil.rmtree(work, ignore_errors=True)

    def median(mode, label, field):
        values = [r for r in all_results[mode] if r['label'] == label]
        if field == 'p50' or field == 'p99':
            return statistics.median(r['latency_ms'][field] for r in values)
        return statistics.median(r[field] for r in values)

    print()
    print('medians of %d runs per mode; load average now %.1f' % (args.rounds, os.getloadavg()[0]))
    print('%-16s %-4s %12s %10s %10s %8s' % ('load', 'mode', 'accepted/s', 'p50 ms', 'p99 ms', 'failed'))
    for label in ['push-anonymous', 'push-account', 'get']:
        for mode in ['on', 'off']:
            failed = sum(r['failed'] for r in all_results[mode] if r['label'] == label)
            print('%-16s %-4s %12.1f %10.2f %10.2f %8d' % (label, mode, median(mode, label, 'accepted_per_second'),
                                                         median(mode, label, 'p50'), median(mode, label, 'p99'), failed))
        off = median('off', label, 'accepted_per_second')
        if off:
            print('%-16s on/off throughput ratio %.3f' % (label, median('on', label, 'accepted_per_second') / off))


if __name__ == '__main__':
    main()
