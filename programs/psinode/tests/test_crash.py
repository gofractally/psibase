#!/usr/bin/python

from psinode import Cluster
from predicates import *
import testutil
import time
import unittest

class TestCrash(unittest.TestCase):
    @testutil.psinode_test
    def test_crash_cft(self, cluster):
        prods = cluster.complete(*testutil.generate_names(3))
        a = testutil.boot_with_producers(prods, packages=['Minimal', 'Explorer'])
        b = cluster.nodes['b']

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

        a.shutdown()
        b.wait(new_block())
        b.wait(irreversible(b.get_block_header()['blockNum']))

        print('checking blocks')
        err = testutil.SuppressErrors(1)
        for i in range(5):
            header = b.get_block_header()
            print(header)
            with err:
                self.assertEqual(header['commitNum'] + 2, header['blockNum'])
            time.sleep(1)

    @testutil.psinode_test
    def test_shutdown_all_cft(self, cluster):
        prods = cluster.complete(*testutil.generate_names(3))
        a = testutil.boot_with_producers(prods, packages=['Minimal', 'Explorer'])
        b = prods[1]
        c = prods[2]

        a.wait(new_block())
        a.wait(irreversible(a.get_block_header()['blockNum']))

        a.shutdown()
        b.shutdown()
        c.shutdown()

        a.start()
        b.start()
        c.start()

        a.connect(b)
        a.connect(c)
        b.connect(c)

        a.wait(new_block())
        a.wait(irreversible(a.get_block_header()['blockNum']))

        print('checking blocks')
        err = testutil.SuppressErrors(1)
        for i in range(5):
            header = b.get_block_header()
            print(header)
            with err:
                self.assertEqual(header['commitNum'] + 2, header['blockNum'])
            time.sleep(1)

    @testutil.psinode_test
    def test_restart_after_disconnect(self, cluster):
        prods = cluster.complete(*testutil.generate_names(4))
        testutil.boot_with_producers(prods, algorithm='cft', packages=['Minimal', 'Explorer'])

        (a, b, c, d) = prods
        # Stop d, so we have no fault tolerance
        d.shutdown()

        c.disconnect(b)
        c.connect(b)
        c.disconnect(a)
        c.connect(a)

        # stop and restart c
        c.shutdown();
        c.start()

        a.connect(c)

        a.wait(new_block())

    @testutil.psinode_test
    def test_shutdown_all_bft(self, cluster):
        prods = cluster.complete(*testutil.generate_names(4))
        a = testutil.boot_with_producers(prods, 'bft', packages=['Minimal', 'Explorer'])
        b = prods[1]
        c = prods[2]
        d = prods[3]

        a.wait(new_block())
        a.wait(irreversible(a.get_block_header()['blockNum']))

        a.shutdown()
        b.shutdown()
        c.shutdown()
        d.shutdown()

        a.start()
        b.start()
        c.start()
        d.start()

        a.connect(b)
        a.connect(c)
        a.connect(d)
        b.connect(c)
        b.connect(d)
        c.connect(d)

        a.wait(new_block())
        a.wait(irreversible(a.get_block_header()['blockNum']))

        print('checking blocks')
        err = testutil.SuppressErrors(1)
        for i in range(5):
            header = b.get_block_header()
            print(header)
            with err:
                self.assertEqual(header['commitNum'] + 2, header['blockNum'])
            time.sleep(1)

if __name__ == '__main__':
    testutil.main()
