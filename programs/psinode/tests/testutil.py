from psinode import Cluster
import predicates
import argparse
import unittest
import sys
import time
import math
import os
import shutil
import subprocess
import requests

def psinode_test(f):
    def result(self):
        with Cluster(executable=args.psinode, log_filter=args.log_filter, log_format=args.log_format, database_cache_size=256*1024*1024) as cluster:
            try:
                try:
                    f(self, cluster)
                except requests.exceptions.HTTPError as e:
                    print(e.response.text)
                    raise
            except:
                for node in cluster.nodes.values():
                    node.print_log()
                raise
            else:
                if args.print_logs is not None:
                    for (hostname, node) in cluster.nodes.items():
                        if hostname in args.print_logs or 'all' in args.print_logs:
                            node.print_log()
    return result

def generate_names(n):
    letters = 'abcdefghijklmnopqrstuvwxyz'
    return list(letters[0:n])

def boot_with_producers(nodes, algorithm=None, timeout=10, packages=[]):
    p = nodes[0]
    print("booting chain")
    p.boot(packages=packages)
    print("setting producers")
    p.set_producers(nodes, algorithm)
    p.wait(predicates.producers_are(nodes), timeout=timeout)
    return p

def sleep(secs, end_at):
    '''Like time.sleep, but waits additional time until the fractional seconds are equal to end_at'''
    ticks_per_sec = 1000000000
    current = (time.time_ns() % ticks_per_sec) / ticks_per_sec
    extra = end_at - (current + math.modf(secs)[0])
    if extra < 0:
        extra += 1

    time.sleep(secs + extra)

class SuppressErrors:
    '''A Context Manager used to handle repeated checks that we expect to pass most of the time'''
    def __init__(self, n):
        self.n = n
    def __enter__(self):
        return self
    def __exit__(self, exc_type, exc_value, traceback):
        if exc_type is not None:
            self.n -= 1
            if self.n >= 0:
                return True

def test_packages():
    result = args.test_packages
    if result is None:
        psinode = shutil.which(args.psinode)
        result = os.path.join(os.path.dirname(psinode), 'test-packages')
    return result

def libsofthsm2():
    result = args.libsofthsm2
    if result is None:
        result = 'libsofthsm2.so'
    return result

def run_test_wasm(command):
    dirname = os.path.dirname(args.psinode)
    if dirname == '':
        psitest = 'psitest'
    elif os.path.exists(os.path.join(dirname, 'psitest')):
        psitest = os.path.join(dirname, 'psitest')
    else:
        psitest = 'psitest'

    test_wasms = args.test_wasms
    if test_wasms is None:
        test_wasms = dirname
    return subprocess.run([psitest, os.path.join(test_wasms, command[0])] + command[1:], check=True)

def main(argv=sys.argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--psinode", default="psinode", help="The path to the psinode executable")
    parser.add_argument('--log-filter', metavar='FILTER', help="Filter for log messages")
    parser.add_argument('--log-format', metavar='FORMAT', help="Format for log messages")
    parser.add_argument('--print-logs', metavar='NODE', action='append', help="Nodes whose logs should be printed")
    parser.add_argument('--test-packages', metavar='DIRECTORY', help="Directory containing test packages")
    parser.add_argument('--libsofthsm2', metavar='PATH', help="Path to libsofthsm.so")
    parser.add_argument('--test-wasms', metavar='PATH', help="Directory containing wasm programs used by the test suite")
    global args
    (args, remaining) = parser.parse_known_args(argv)
    unittest.main(argv=remaining)
