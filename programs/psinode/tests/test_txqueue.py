#!/usr/bin/python

import testutil
import unittest
from predicates import *
import time
import psinode
from services import Tokens, TransactionQueue

class TestTransactionQueue(unittest.TestCase):
    @testutil.psinode_test
    def test_submit(self, cluster):
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['Minimal', 'Explorer', 'TokenUsers'])

        tokens = Tokens(a)
        old_balance = tokens.balance('alice', token=1)

        txqueue = TransactionQueue(a)
        txqueue.push_action('alice', 'tokens', 'credit', {"tokenId":1,"receiver":"bob","amount":{"value":10000}, "memo":"test"})

        a.wait(new_block())
        new_balance = tokens.balance('alice', token=1)
        self.assertEqual(old_balance - 10000, new_balance)

    @testutil.psinode_test
    def test_forward(self, cluster):
        prods = cluster.complete(*testutil.generate_names(3))
        a = testutil.boot_with_producers(prods, packages=['Minimal', 'Explorer', 'TokenUsers'])

        tokens = Tokens(a)
        old_balance = tokens.balance('alice', token=1)

        txqueue = TransactionQueue(prods[2])
        txqueue.push_action('alice', 'tokens', 'credit', {"tokenId":1,"receiver":"bob","amount":{"value":10000}, "memo":"test"})

        a.wait(new_block())
        new_balance = tokens.balance('alice', token=1)
        self.assertEqual(old_balance - 10000, new_balance)

if __name__ == '__main__':
    testutil.main()
