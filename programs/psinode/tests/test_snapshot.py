#!/usr/bin/python

from psinode import Cluster
import testutil
import predicates
import unittest
import os

class TestSnapshot(unittest.TestCase):
    @testutil.psinode_test
    def test_snapshot(self, cluster):
        prods = cluster.complete(*testutil.generate_names(4))
        (a, b, c, d) = prods
        a.boot(packages=['Minimal', 'Explorer', 'AuthSig'])
        # Multisig transactions (and signed transactions in general) are not implemented in python
        a.push_action('root', 'accounts', 'setAuthServ', {'authService': 'auth-any'})
        auth = []
        for p in prods:
            with p.post('/native/admin/keys', service='x-admin', json={"service":"verify-sig"}) as reply:
                reply.raise_for_status()
                print(reply.json())
                auth.append({"name":p.producer, "auth":reply.json()[0]})
        a.set_producers(auth[0:3], algorithm='cft')
        a.wait(predicates.producers_are(prods[0:3]))
        a.set_producers(auth, algorithm='bft')
        a.wait(predicates.producers_are(prods))
        a.push_action('transact', 'transact', 'setSnapTime', {"seconds": 5})
        a.set_producers(auth[0:3], algorithm='cft')
        a.wait(predicates.producers_are(prods[0:3]))
        a.wait(predicates.new_block())
        a.wait(predicates.new_block())
        a.shutdown()
        # Load two nodes from snapshots
        e = cluster.make_node('e', start=False)
        f = cluster.make_node('f', start=False)
        a.run_psibase(['create-snapshot', a.dir, os.path.join(a.dir, 'snapshot')])
        e.run_psibase(['load-snapshot', e.dir, os.path.join(a.dir, 'snapshot')])
        # Make sure that loading from a snapshot leaves a state that is able
        # to create snapshots
        e.run_psibase(['create-snapshot', '--gzip', e.dir, os.path.join(e.dir, 'snapshot')])
        f.run_psibase(['load-snapshot', f.dir, os.path.join(e.dir, 'snapshot')])
        e.start()
        f.start()
        e.connect(f)
        b.connect(e)
        b.connect(f)
        c.connect(e)
        c.connect(f)
        b.set_producers([e, f, 'missing'], algorithm='cft')
        b.wait(predicates.producers_are(['e', 'f', 'missing']))
        # Make sure that nodes can sync with a node that loaded a snapshot
        g = cluster.make_node('g')
        h = cluster.make_node('h') # connected to g before g loads a snapshot
        g.connect(h)
        g.connect(e)
        pred = predicates.new_block()
        g.wait(pred)
        h.wait(pred)

        # Check that the x-admin service was set up on the nodes
        # that were created by load-snapshot
        with e.get('/admin_accounts', service='x-admin') as reply:
            reply.raise_for_status()
            self.assertEqual(reply.json(), [])

if __name__ == '__main__':
    testutil.main()
