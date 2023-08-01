#!/usr/bin/python

from psinode import Cluster
from predicates import *
import testutil
import time
import unittest

class TestRouting(unittest.TestCase):
    @testutil.psinode_test
    def test_routing(self, cluster):
        # Each node is adjacent to two others. With 7 nodes, consensus
        # requires 4 nodes, so this test will time out if messages are not routed
        prods = cluster.ring(*testutil.generate_names(7))
        a = testutil.boot_with_producers(prods)

        # wait for irreversibility to advance
        a.wait(new_block())
        a.wait(irreversible(a.get_block_header()['blockNum']))

        # We expect irreversible to be behind by 2
        print('checking blocks')
        for i in range(5):
            header = a.get_block_header()
            print(header)
            self.assertEqual(header['commitNum'] + 2, header['blockNum'])
            time.sleep(1)

    @testutil.psinode_test
    def test_change_route(self, cluster):
        # Each node is a adjacent to two others. With 7 nodes, consensus
        # requires 4 nodes, so this test will time out if messages are not routed
        (a, b, c, d, e, f, g) = cluster.ring('a', 'b', 'c', 'd', 'e', 'f', 'g')
        testutil.boot_with_producers([a, b, c, d, e, f, g])

        # wait for irreversibility to advance
        a.wait(new_block())
        a.wait(irreversible(a.get_block_header()['blockNum']))

        a.disconnect(b)

        # Switch between two different configurations
        print('checking blocks')
        for i in range(10):
            header = a.get_block_header()
            print(header)
            if header['commitNum'] + 2 != header['blockNum']:
                raise RuntimeError('unexpected commitNum: %s' % header)
            time.sleep(1)
            if i % 2 == 0:
                a.connect(b)
                a.disconnect(g)
            else:
                a.connect(g)
                a.disconnect(b)

if __name__ == '__main__':
    testutil.main()
