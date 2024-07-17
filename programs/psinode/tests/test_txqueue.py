#!/usr/bin/python

import testutil
import unittest
from predicates import *
import time
import psinode
from services import Tokens, Transact

class TestTransactionQueue(unittest.TestCase):
    @testutil.psinode_test
    def test_submit(self, cluster):
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['Minimal', 'Explorer', 'TokenUsers'])

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

        with self.assertRaises(psinode.TransactionError, msg='Transaction expired'):
            txqueue.push_action('alice', 'tokens', 'credit', {"tokenId":1,"receiver":"bob","amount":{"value":100000000}, "memo":"fail"})

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
