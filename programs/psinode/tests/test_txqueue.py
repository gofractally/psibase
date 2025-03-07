#!/usr/bin/python

import testutil
import unittest
from predicates import *
import time
from threading import Thread
from psinode import Action, Transaction, TransactionError
from services import Tokens, Transact

class TestTransactionQueue(unittest.TestCase):
    @testutil.psinode_test
    def test_submit(self, cluster):
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['Minimal', 'Explorer', 'TokenUsers'])
        a.install(sources=[testutil.test_packages()], packages=['SubjectiveCounter'])
        a.wait(new_block())

        tokens = Tokens(a)
        old_balance = tokens.balance('alice', token=1)

        txqueue = Transact(a)
        txqueue.push_action('alice', 'tokens', 'credit', {"tokenId":1,"receiver":"bob","amount":{"value":10000}, "memo":"test"})

        a.wait(new_block())
        new_balance = tokens.balance('alice', token=1)
        self.assertEqual(old_balance - 10000, new_balance)

        with txqueue.get('/foo') as response:
            print(response.text)
            self.assertEqual(response.status_code, 404)

        with self.assertRaises(TransactionError, msg='Transaction expired'):
            txqueue.push_action('alice', 'tokens', 'credit', {"tokenId":1,"receiver":"bob","amount":{"value":100000000}, "memo":"fail"}, timeout=4)

        with self.assertRaises(TransactionError, msg="Transaction expired"):
            inc = Action('alice', 's-counter', 'inc', {"key":"","id":0})
            fail = Action('alice', 'tokens', 'credit', {"tokenId":1,"receiver":"bob","amount":{"value":100000000}, "memo":"fail"})
            txqueue.push_transaction(Transaction(a.get_tapos(timeout=4), [inc, fail], []))
        with a.get('/value', 's-counter') as response:
            response.raise_for_status()
            self.assertEqual(response.json(), 1)

    @testutil.psinode_test
    def test_forward(self, cluster):
        prods = cluster.complete(*testutil.generate_names(3))
        a = testutil.boot_with_producers(prods, packages=['Minimal', 'Explorer', 'TokenUsers'])

        tokens = Tokens(a)
        old_balance = tokens.balance('alice', token=1)

        txqueue = Transact(prods[2])
        txqueue.push_action('alice', 'tokens', 'credit', {"tokenId":1,"receiver":"bob","amount":{"value":10000}, "memo":"test"})

        a.wait(new_block())
        new_balance = tokens.balance('alice', token=1)
        self.assertEqual(old_balance - 10000, new_balance)

    @testutil.psinode_test
    def test_restart_node(self, cluster):
        (a, b) = cluster.complete(*testutil.generate_names(2))
        a.boot(packages=['Minimal', 'Explorer', 'TokenUsers'])

        # Make sure that b is ready
        b.wait(new_block())

        # Make sure that transactions submitted to b can't reach the producer 
        b.disconnect(a)

        tx = b.pack_signed_transaction(Transaction(b.get_tapos(), actions=[Action('alice', 'tokens', 'credit', {"tokenId":1,"receiver":"bob","amount":{"value":10000}, "memo":"test"})], claims=[]))

        # This should not return, because b is not getting new blocks
        def run_delayed():
            try:
                b.push_transaction(tx)
            except:
                pass
        delayed = Thread(target=run_delayed)
        delayed.start()

        # Push the same transaction to a
        a.push_transaction(tx)

        # Kill and restart b
        b.shutdown(force=True)
        b.start()
        delayed.join()

        # Submit another transaction to b
        tx2 = b.pack_signed_transaction(Transaction(b.get_tapos(), actions=[Action('bob', 'tokens', 'credit', {"tokenId":1,"receiver":"alice","amount":{"value":10000}, "memo":"back"})], claims=[]))
        traces = []
        t2thread = Thread(target=lambda: traces.append(b.push_transaction(tx2)))
        t2thread.start()

        # Reconnect b to start receiving transactions
        b.connect(a)

        a.push_transaction(tx2)
        t2thread.join();

        found_bob = False
        for trace in traces[0]['actionTraces'][0]['innerTraces']:
            if 'ActionTrace' in trace['inner']:
                action = trace['inner']['ActionTrace']['action']
                if action['service'] == 'tokens' and action['method'] == 'credit':
                    if action['sender'] == 'bob':
                        found_bob = True
                    self.assertNotEqual(action['sender'], 'alice')
        self.assertTrue(found_bob)

if __name__ == '__main__':
    testutil.main()
