#!/usr/bin/python

"""Integration tests for x-webrtcsig (T-006): websocket auth, welcome, presence."""

import json
import testutil
import unittest
import urllib3
import websockets
from websockets.exceptions import InvalidStatus

from predicates import new_block
from services import Transact

REALTIME_SUBPROTOCOL = 'psibase.realtime.v1'


def websocket_url(node, path='/', service=None):
    url = urllib3.util.parse_url(node.url)
    if service is not None:
        host = service + '.' + url.host
    else:
        host = url.host
    return urllib3.util.Url('ws', url.auth, host, url.port, path).url


def _unix_connect(node, url, headers):
    kwargs = {'subprotocols': [REALTIME_SUBPROTOCOL]}
    if headers:
        kwargs['additional_headers'] = headers
    return websockets.unix_connect(node.socketpath, url, **kwargs)


async def _read_json(ws):
    raw = await ws.recv()
    if isinstance(raw, bytes):
        raw = raw.decode()
    return json.loads(raw)


class TestXWebRtcSig(unittest.TestCase):
    def _boot_with_webrtcsig(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))
        a.boot(packages=['Minimal', 'Explorer', 'TokenUsers', 'AuthSig'])
        a.install_local(['XWebRtcSig'])
        a.wait(new_block())
        return a

    async def _welcome(self, ws):
        msg = await _read_json(ws)
        self.assertEqual(msg.get('t'), 'welcome')
        self.assertIn('user', msg)
        self.assertIn('serverTime', msg)
        self.assertIn('iceServers', msg)
        self.assertIsInstance(msg['iceServers'], list)
        return msg

    async def _presence_snapshot(self, ws):
        msg = await _read_json(ws)
        self.assertEqual(msg.get('t'), 'presenceSnapshot')
        self.assertIn('contacts', msg)
        return msg

    @testutil.psinode_test
    def test_ws_bearer_auth_welcome(self, cluster):
        """Bearer auth on /ws returns welcome with user, serverTime, iceServers."""
        a = self._boot_with_webrtcsig(cluster)
        tok = Transact(a).login('alice')
        url = websocket_url(a, '/ws', service='x-webrtcsig')
        headers = [('Authorization', 'Bearer ' + tok)]

        async def body():
            async with _unix_connect(a, url, headers) as ws:
                w = await self._welcome(ws)
                self.assertEqual(w['user'], 'alice')

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_ws_unauthenticated_rejected(self, cluster):
        """Unauthenticated /ws upgrade must fail (401)."""
        a = self._boot_with_webrtcsig(cluster)
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            async with _unix_connect(a, url, []):
                pass

        import asyncio
        with self.assertRaises(InvalidStatus) as cm:
            asyncio.run(body())
        self.assertEqual(cm.exception.response.status_code, 401)

    @testutil.psinode_test
    def test_presence_fanout_on_connect(self, cluster):
        """Second connect fans out online presence to existing peer."""
        a = self._boot_with_webrtcsig(cluster)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            async with _unix_connect(a, url, [('Authorization', 'Bearer ' + ta)]) as ws_a:
                await self._welcome(ws_a)
                await self._presence_snapshot(ws_a)

                async with _unix_connect(
                    a, url, [('Authorization', 'Bearer ' + tb)]
                ) as ws_b:
                    await self._welcome(ws_b)
                    snap_b = await self._presence_snapshot(ws_b)
                    contacts = {c['account']: c['presence'] for c in snap_b['contacts']}
                    self.assertEqual(contacts.get('alice'), 'online')

                    delta_a = await _read_json(ws_a)
                    self.assertEqual(delta_a['t'], 'presence')
                    self.assertEqual(delta_a['account'], 'bob')
                    self.assertEqual(delta_a['status'], 'online')

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_presence_offline_on_disconnect(self, cluster):
        """Final socket close fans out offline presence to peers."""
        a = self._boot_with_webrtcsig(cluster)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            async with _unix_connect(
                a, url, [('Authorization', 'Bearer ' + tb)]
            ) as ws_b:
                await self._welcome(ws_b)
                await self._presence_snapshot(ws_b)

                async with _unix_connect(
                    a, url, [('Authorization', 'Bearer ' + ta)]
                ) as ws_a:
                    await self._welcome(ws_a)
                    await self._presence_snapshot(ws_a)
                    await _read_json(ws_b)  # bob sees alice online

                offline = await _read_json(ws_b)
                self.assertEqual(offline['t'], 'presence')
                self.assertEqual(offline['account'], 'alice')
                self.assertEqual(offline['status'], 'offline')
                self.assertNotIn('socketCount', offline)

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_multi_socket_still_online_presence(self, cluster):
        """Two tabs for one user: first close stays online with socketCount."""
        a = self._boot_with_webrtcsig(cluster)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            async with _unix_connect(
                a, url, [('Authorization', 'Bearer ' + ta)]
            ) as ws_a1, _unix_connect(
                a, url, [('Authorization', 'Bearer ' + ta)]
            ) as ws_a2, _unix_connect(
                a, url, [('Authorization', 'Bearer ' + tb)]
            ) as ws_b:
                await self._welcome(ws_a1)
                await self._presence_snapshot(ws_a1)
                await self._welcome(ws_a2)
                await self._presence_snapshot(ws_a2)
                await self._welcome(ws_b)
                await self._presence_snapshot(ws_b)
                await _read_json(ws_a1)  # bob online to alice tab 1
                await _read_json(ws_a2)  # bob online to alice tab 2

                await ws_a1.close()
                first = await _read_json(ws_b)
                self.assertEqual(first['t'], 'presence')
                self.assertEqual(first['account'], 'alice')
                self.assertEqual(first['status'], 'online')
                self.assertEqual(first.get('socketCount'), 1)

                await ws_a2.close()
                second = await _read_json(ws_b)
                self.assertEqual(second['t'], 'presence')
                self.assertEqual(second['account'], 'alice')
                self.assertEqual(second['status'], 'offline')

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_client_ready_ping_no_chat_frames(self, cluster):
        """clientReady and ping work; chat frame types are rejected."""
        a = self._boot_with_webrtcsig(cluster)
        tok = Transact(a).login('alice')
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            async with _unix_connect(a, url, [('Authorization', 'Bearer ' + tok)]) as ws:
                await self._welcome(ws)
                await self._presence_snapshot(ws)

                await ws.send(
                    json.dumps(
                        {
                            't': 'clientReady',
                            'clientInstanceId': 'inst-1',
                            'active': True,
                            'visible': True,
                            'supports': {
                                'audio': True,
                                'video': False,
                                'data': True,
                            },
                        }
                    )
                )

                await ws.send(json.dumps({'t': 'ping'}))
                pong = await _read_json(ws)
                self.assertEqual(pong['t'], 'pong')

                await ws.send(json.dumps({'t': 'say', 'body': 'no chat on this socket'}))
                err = await _read_json(ws)
                self.assertEqual(err['t'], 'error')
                self.assertEqual(err['code'], 'bad-frame')

        import asyncio
        asyncio.run(body())


if __name__ == '__main__':
    testutil.main()
