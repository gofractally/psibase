#!/usr/bin/python

import testutil
import unittest
from predicates import *
import time
from psinode import Action, Transaction, TransactionError
from services import Tokens, Transact

class TestTransactionQueue(unittest.TestCase):
    @testutil.psinode_test
    def test_submit(self, cluster):
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['Minimal', 'Explorer', 'TokenUsers'])
        a.install(args=['--package-source', testutil.test_packages(), 'SubjectiveCounter'])
        # a.run_psibase(['install'] + self.node_args() + ['--package-source', testutil.test_packages(), 'SubjectiveCounter'])
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

if __name__ == '__main__':
    testutil.main()
