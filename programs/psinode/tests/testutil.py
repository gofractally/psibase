from psinode import Cluster
import predicates
import argparse
import unittest
import sys
import time
import math

def psinode_test(f):
    def result(self):
        with Cluster(executable=args.psinode, log_filter=args.log_filter, log_format=args.log_format, database_cache_size=256*1024*1024) as cluster:
            try:
                f(self, cluster)
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

def boot_with_producers(nodes, algorithm=None, timeout=10):
    p = nodes[0]
    print("booting chain")
    p.boot()
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

def main(argv=sys.argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--psinode", default="psinode", help="The path to the psinode executable")
    parser.add_argument('--log-filter', metavar='FILTER', help="Filter for log messages")
    parser.add_argument('--log-format', metavar='FORMAT', help="Format for log messages")
    parser.add_argument('--print-logs', metavar='NODE', action='append', help="Nodes whose logs should be printed")
    global args
    (args, remaining) = parser.parse_known_args(argv)
    unittest.main(argv=remaining)
