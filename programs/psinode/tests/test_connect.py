#!/usr/bin/python


from psinode import Cluster
from predicates import *
import testutil
import time
import unittest

class TestConnect(unittest.TestCase):
    @testutil.psinode_test
    def test_dedup(self, cluster):
        a = cluster.make_node('a')
        b = cluster.make_node('b')

        a.connect(b)
        b.connect(a)

        def one_connection(other):
            def fn(node):
                with node.get('/peers', service='x-peers') as reply:
                    reply.raise_for_status()
                    peers = reply.json()
                    print("peers: %s" % peers)
                    return len(peers) == 1 and other.socketpath in peers[0]['urls']
            return fn
        a.wait(one_connection(b))
        b.wait(one_connection(a))

if __name__ == '__main__':
    testutil.main()
