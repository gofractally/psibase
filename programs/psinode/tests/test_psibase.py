#!/usr/bin/python

from psinode import Cluster
from predicates import *
import testutil
import time
import unittest

class TestPsibase(unittest.TestCase):
    @testutil.psinode_test
    def test_install(self, cluster):
        a = cluster.complete(*testutil.generate_names(1))[0]
        a.boot(packages=['Minimal', 'ExploreSys'])
        a.run_psibase(['install', 'SymbolSys', 'TokenSys', 'TokenUsers'])
        a.wait(new_block())
        a.graphql('token-sys', '''query { userBalances(user: "alice") { user balance precision token symbol } }''')

if __name__ == '__main__':
    testutil.main()
