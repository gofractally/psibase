#!/usr/bin/python

import testutil
import unittest
import urllib3
import os
import threading
from services import XAdmin
import websockets.sync.client
import websockets.sync.server
import websockets.exceptions

def websocket_url(node, path='/', service=None):
    url = urllib3.util.parse_url(node.url)
    if service is not None:
        host = service + '.' + url.host
    else:
        host = url.host
    return urllib3.util.Url('ws', url.auth, host, url.port, path).url

def echo(connection):
    try:
        for msg in connection:
            connection.send(msg)
    except websockets.exceptions.ConnectionClosedError:
        pass

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

    @testutil.psinode_test
    def test_proxy(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))

        XAdmin(a).install(os.path.join(testutil.test_packages(), "XProxy.psi"))

        server = websockets.sync.server.serve(echo, host='127.0.0.1', port=0)

        t = threading.Thread(target=server.serve_forever)
        t.start()
        try:
            with a.post('/set_origin_server', service='x-proxy', json={"host":"localhost:%d" % server.socket.getsockname()[1]}) as reply:
                reply.raise_for_status()

            url = websocket_url(a, '/', service='x-proxy')
            with websockets.sync.client.unix_connect(a.socketpath, url, compression=None) as websocket:
                for message in ['lorem', 'ipsum', 'dolor', 'sit', 'amet']:
                    websocket.send(message)
                    self.assertEqual(websocket.recv(decode=True), message)
        finally:
            server.shutdown()
            t.join()

if __name__ == '__main__':
    testutil.main()
