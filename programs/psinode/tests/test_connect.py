#!/usr/bin/python


from psinode import Cluster
from predicates import *
from services import Transact
import testutil
import time
import unittest
from requests.exceptions import HTTPError

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

    @testutil.psinode_test
    def test_auth(self, cluster):
        a = cluster.make_node('a', p2p=False)
        b = cluster.make_node('b', p2p=False)

        with self.assertRaises(HTTPError):
            b.connect(a)

        a.boot(packages=['Minimal', 'Explorer'])

        with a.post('/users', service='x-peers', json={"account":"a","accept":True}) as reply:
            reply.raise_for_status()
        # For now, p2p always uses the hostname psibase.localhost for local sockets.
        # This means the token also needs to use psibase.localhost.
        a.url = "http://psibase.localhost/"
        token = Transact(a).login('a')
        with b.post('/authorization', service='x-peers', json={"url": a.socketpath, "token": token}) as reply:
            reply.raise_for_status()

        b.connect(a)

if __name__ == '__main__':
    testutil.main()
