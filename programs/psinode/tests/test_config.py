#!/usr/bin/python

import testutil
import unittest

class TestConfig(unittest.TestCase):
    @testutil.psinode_test
    def test_database_cache_size(self, cluster):
        MiB = 1024*1024
        a = cluster.make_node(database_cache_size=1024*MiB)
        a.shutdown()
        a.start(database_cache_size=256*MiB)
        a.shutdown()
        a.start(database_cache_size=512*MiB)

if __name__ == '__main__':
    testutil.main()
