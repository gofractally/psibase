#!/usr/bin/python

from psinode import Cluster
from predicates import *
import time
import argparse

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--psinode", default="psinode", help="The path to the psinode executable")
    args = parser.parse_args()
    cluster = Cluster(executable=args.psinode)

    # Each node is a adjacent to two others. With 7 nodes, consensus
    # requires 4 nodes, so this test will time out if messages are not routed
    (a, b, c, d, e, f, g) = cluster.ring('a', 'b', 'c', 'd', 'e', 'f', 'g')

    print("booting chain")
    a.boot()
    print("setting producers")
    a.set_producers([a, b, c, d, e, f, g], 'cft')
    a.wait(producers_are(['a', 'b', 'c', 'd', 'e', 'f', 'g']))

    # wait for irreversibility to advance
    a.wait(new_block())
    a.wait(irreversible(a.get_block_header()['blockNum']))

    # We expect irreversible to be behind by 2
    print('checking blocks')
    for i in range(5):
        header = a.get_block_header()
        print(header)
        if header['commitNum'] + 2 != header['blockNum']:
            raise RuntimeError('unexpected commitNum: %s' % header)
        time.sleep(1)

main()
