#!/usr/bin/python

import testutil
import unittest
import urllib3
import os
import threading
from services import XAdmin
import websockets

def websocket_url(node, path='/', service=None):
    url = urllib3.util.parse_url(node.url)
    if service is not None:
        host = service + '.' + url.host
    else:
        host = url.host
    return urllib3.util.Url('ws', url.auth, host, url.port, path).url

async def echo(connection):
    async for msg in connection:
        await connection.send(msg)

async def send_some(connection):
    for msg in ["lorem", "ipsum", "dolor", "sit", "amet"]:
        await connection.send(msg)

def decode(arg):
    if isinstance(arg, bytes):
        return arg.decode()
    else:
        return arg

class TestWebSocket(unittest.TestCase):
    @testutil.psinode_test
    async def test_echo(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))

        XAdmin(a).install(os.path.join(testutil.test_packages(), "WSEcho.psi"))
        url = websocket_url(a, '/echo', service='x-echo')

        async with websockets.unix_connect(a.socketpath, url) as websocket:
            for message in ['lorem', 'ipsum', 'dolor', 'sit', 'amet']:
                await websocket.send(message)
                self.assertEqual(decode(await websocket.recv()), message)

    @testutil.psinode_test
    async def test_fast_recv(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))

        XAdmin(a).install(os.path.join(testutil.test_packages(), "XProxy.psi"))

        async with websockets.serve(send_some, host='127.0.0.1', port=0) as server:
            with a.post('/set_origin_server', service='x-proxy', json={"host":"localhost:%d" % server.sockets[0].getsockname()[1]}) as reply:
                reply.raise_for_status()

            url = websocket_url(a, '/', service='x-proxy')
            async with websockets.unix_connect(a.socketpath, url) as websocket:
                for message in ['lorem', 'ipsum', 'dolor', 'sit', 'amet']:
                    self.assertEqual(decode(await websocket.recv()), message)

    @testutil.psinode_test
    async def test_proxy(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))

        XAdmin(a).install(os.path.join(testutil.test_packages(), "XProxy.psi"))
        XAdmin(a).install(os.path.join(testutil.test_packages(), "XSocketList.psi"))

        async with websockets.serve(echo, host='127.0.0.1', port=0) as server:
            with a.post('/set_origin_server', service='x-proxy', json={"host":"localhost:%d" % server.sockets[0].getsockname()[1]}) as reply:
                reply.raise_for_status()

            url = websocket_url(a, '/', service='x-proxy')
            async with websockets.unix_connect(a.socketpath, url, compression=None) as websocket:
                for message in ['lorem', 'ipsum', 'dolor', 'sit', 'amet']:
                    await websocket.send(message)
                    self.assertEqual(decode(await websocket.recv()), message)

                # There should be one unix and one http websocket

                sockets = a.graphql(service='x-sock-list', query='''
                query {
                    sockets {
                        edges {
                            node {
                                fd
                                info {
                                    ... on WebSocketInfo {
                                        endpoint
                                    }
                                }
                            }
                        }
                    }
                }
                ''')

            sockets = [edge['node']['info'].get('endpoint') for edge in sockets['sockets']['edges']]
            sockets = [socket for socket in sockets if socket is not None]
            expected = ['', "127.0.0.1:%d" % server.sockets[0].getsockname()[1]]
            self.assertCountEqual(sockets, expected)

    @testutil.psinode_test
    async def test_deflate(self, cluster):
        '''
        This checks that the permessage-deflate extension can be requested from
        the server. If the implementation does not support this extension, it
        should be ignored.
        '''
        (a,) = cluster.complete(*testutil.generate_names(1))

        XAdmin(a).install(os.path.join(testutil.test_packages(), "XProxy.psi"))

        async with websockets.serve(echo, host='127.0.0.1', port=0) as server:
            with a.post('/set_origin_server', service='x-proxy', json={"host":"localhost:%d" % server.sockets[0].getsockname()[1]}) as reply:
                reply.raise_for_status()

            url = websocket_url(a, '/', service='x-proxy')
            async with websockets.unix_connect(a.socketpath, url, compression='deflate') as websocket:
                for message in ['lorem', 'ipsum', 'dolor', 'sit', 'amet']:
                    await websocket.send(message)
                    self.assertEqual(decode(await websocket.recv()), message)

if __name__ == '__main__':
    testutil.main()
