from psinode import Cluster
import predicates
import argparse
import unittest
import sys

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

def main(argv=sys.argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--psinode", default="psinode", help="The path to the psinode executable")
    parser.add_argument('--log-filter', metavar='FILTER', help="Filter for log messages")
    parser.add_argument('--log-format', metavar='FORMAT', help="Format for log messages")
    parser.add_argument('--print-logs', metavar='NODE', action='append', help="Nodes whose logs should be printed")
    global args
    (args, remaining) = parser.parse_known_args(argv)
    unittest.main(argv=remaining)
