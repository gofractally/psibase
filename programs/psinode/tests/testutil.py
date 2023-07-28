from psinode import Cluster
import argparse
import unittest
import sys

def psinode_test(f):
    def result(self):
        with Cluster(executable=args.psinode, log_filter=args.log_filter, log_format=args.log_format) as cluster:
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

def main(argv=sys.argv):
    parser = argparse.ArgumentParser()
    parser.add_argument("--psinode", default="psinode", help="The path to the psinode executable")
    parser.add_argument('--log-filter', metavar='FILTER', help="Filter for log messages")
    parser.add_argument('--log-format', metavar='FORMAT', help="Format for log messages")
    parser.add_argument('--print-logs', metavar='NODE', action='append', help="Nodes whose logs should be printed")
    global args
    (args, remaining) = parser.parse_known_args(argv)
    unittest.main(argv=remaining)
