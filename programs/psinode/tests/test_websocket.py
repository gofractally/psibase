#!/usr/bin/python

import testutil
import unittest
import urllib3
import os
from services import XAdmin
import websockets.sync.client

def websocket_url(node, path='/', service=None):
    url = urllib3.util.parse_url(node.url)
    if service is not None:
        host = service + '.' + url.host
    else:
        host = url.host
    return urllib3.util.Url('ws', url.auth, host, url.port, path).url

class TestWebSocket(unittest.TestCase):
    @testutil.psinode_test
    def test_echo(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))

        XAdmin(a).install(os.path.join(testutil.test_packages(), "WSEcho.psi"))
        url = websocket_url(a, '/echo', service='x-echo')

        with websockets.sync.client.unix_connect(a.socketpath, url) as websocket:
            for message in ['lorem', 'ipsum', 'dolor', 'sit', 'amet']:
                websocket.send(message)
                self.assertEqual(websocket.recv(decode=True), message)

if __name__ == '__main__':
    testutil.main()
