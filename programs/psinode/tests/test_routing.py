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
        a = testutil.boot_with_producers(prods, packages=['Minimal', 'Explorer'])

        # wait for irreversibility to advance
        a.wait(new_block())
        a.wait(irreversible(a.get_block_header()['blockNum']))

        # We expect irreversible to be behind by 2
        print('checking blocks')
        err = testutil.SuppressErrors(1)
        for i in range(5):
            header = a.get_block_header()
            print(header)
            with err:
                self.assertEqual(header['commitNum'] + 2, header['blockNum'])
            time.sleep(1)

    @testutil.psinode_test
    def test_change_route(self, cluster):
        # Each node is a adjacent to two others. With 7 nodes, consensus
        # requires 4 nodes, so this test will time out if messages are not routed
        (a, b, c, d, e, f, g) = cluster.ring('a', 'b', 'c', 'd', 'e', 'f', 'g')
        testutil.boot_with_producers([a, b, c, d, e, f, g], packages=['Minimal', 'Explorer'])

        # wait for irreversibility to advance
        a.wait(new_block())
        a.wait(irreversible(a.get_block_header()['blockNum']))

        a.disconnect(b)

        # Switch between two different configurations
        print('checking blocks')
        err = testutil.SuppressErrors(1)
        for i in range(10):
            header = a.get_block_header()
            print(header)
            with err:
                commitLag = header['blockNum'] - header['commitNum']
                self.assertLessEqual(commitLag, 3)
                self.assertGreaterEqual(commitLag, 2)
            time.sleep(1)
            if i % 2 == 0:
                a.connect(b)
                a.disconnect(g)
            else:
                a.connect(g)
                a.disconnect(b)

    @testutil.psinode_test
    def test_min_nodes(self, cluster):
        # Each node is a adjacent to two others. With 7 nodes, consensus
        # requires 4 nodes, so this test will time out if messages are not routed
        (a, b, c, d, e, f, g) = cluster.ring('a', 'b', 'c', 'd', 'e', 'f', 'g')
        testutil.boot_with_producers([a, b, c, d, e, f, g, 'h', 'i', 'j', 'k', 'l', 'm'], packages=['Minimal', 'Explorer'])

        # wait for irreversibility to advance
        a.wait(new_block())
        a.wait(irreversible(a.get_block_header()['blockNum']))

        a.disconnect(b)

        # Switch between two different configurations
        print('checking blocks')
        err = testutil.SuppressErrors(1)
        testutil.sleep(0.0, 0.5)
        for i in range(10):
            header = a.get_block_header()
            print(header)
            with err:
                commitLag = header['blockNum'] - header['commitNum']
                self.assertLessEqual(commitLag, 3)
                self.assertGreaterEqual(commitLag, 2)
            testutil.sleep(0.5, 0.5)
            if i % 2 == 0:
                a.connect(b)
                a.disconnect(g)
            else:
                a.connect(g)
                a.disconnect(b)

    @testutil.psinode_test
    def test_bft(self, cluster):
        (a, b, c, d, e, f, g) = cluster.ring('a', 'b', 'c', 'd', 'e', 'f', 'g')
        testutil.boot_with_producers([a, b, c, d, e, f, g], 'bft', packages=['Minimal', 'Explorer'])

        # wait for irreversibility to advance
        a.wait(new_block())
        a.wait(irreversible(a.get_block_header()['blockNum']))

        a.disconnect(g)

        # Switch between two different configurations
        print('checking blocks')
        err = testutil.SuppressErrors(1)
        testutil.sleep(0.0, 0.5)
        for i in range(10):
            header = a.get_block_header()
            print(header)
            with err:
                commitLag = header['blockNum'] - header['commitNum']
                self.assertLessEqual(commitLag, 3)
                self.assertGreaterEqual(commitLag, 2)
            testutil.sleep(0.5, 0.5)
            if i % 2 == 0:
                a.connect(g)
                a.disconnect(b)
            else:
                a.connect(b)
                a.disconnect(g)

    @testutil.psinode_test
    def test_bft_min_nodes(self, cluster):
        (a, b, c, d, e, f, g) = cluster.ring('a', 'b', 'c', 'd', 'e', 'f', 'g')
        testutil.boot_with_producers([a, b, c, d, e, f, g, 'h', 'i', 'j'], 'bft', packages=['Minimal', 'Explorer'])

        # wait for irreversibility to advance
        a.wait(new_block())
        a.wait(irreversible(a.get_block_header()['blockNum']))

        a.disconnect(g)

        # Switch between two different configurations
        print('checking blocks')
        err = testutil.SuppressErrors(1)
        testutil.sleep(0.0, 0.5)
        for i in range(10):
            header = a.get_block_header()
            print(header)
            with err:
                commitLag = header['blockNum'] - header['commitNum']
                self.assertLessEqual(commitLag, 3)
                self.assertGreaterEqual(commitLag, 2)
            testutil.sleep(0.5, 0.5)
            if i % 2 == 0:
                a.connect(g)
                a.disconnect(b)
            else:
                a.connect(b)
                a.disconnect(g)

if __name__ == '__main__':
    testutil.main()
