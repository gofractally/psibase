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

    @testutil.psinode_test
    def test_unlock_bft(self, cluster):
        prods = cluster.complete(*testutil.generate_names(4), softhsm=testutil.libsofthsm2())
        (a, b, c, d) = prods
        keys = []
        for p in prods:
            device = p.unlock_softhsm()
            with p.post('/native/admin/keys', service='x-admin', json={'service':'verify-sig', 'device': device}) as reply:
                reply.raise_for_status()
                keys.append({'name': p.producer, 'auth': reply.json()[0]})

        print(keys)
        print("booting chain")
        a.boot(packages=['Minimal', 'Explorer', 'AuthSig'])
        print("setting producers")
        a.set_producers(keys, 'bft')
        p.wait(producers_are(prods))

        print('stopping nodes')
        c.shutdown()
        d.shutdown()
        a.wait(no_new_blocks())
        print('restarting nodes')
        c.start()
        d.start()
        c.connect(a)
        d.connect(a)
        with self.assertRaises(TimeoutError):
            a.wait(new_block())

        c.unlock_softhsm()
        d.unlock_softhsm()

        a.wait(new_block())

if __name__ == '__main__':
    testutil.main()
