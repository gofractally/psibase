#!/usr/bin/python

"""Integration tests for x-pslack (see .agent-team/tasks.yaml T-007)."""

import json
import os
import testutil
import unittest
import urllib3
import websockets
from websockets.exceptions import InvalidStatus

from predicates import new_block
from psinode import PrivateKey
from services import Transact


def _create_signed_account(a, name, key):
    """Register a new account and install auth-sig keys (pattern: test_psibase.test_sign)."""
    key_file = os.path.join(a.dir, name + '.pem')
    pubkey_file = os.path.join(a.dir, name + '.pub')
    with open(key_file, 'w') as f:
        f.write(key.pkcs8())
    with open(pubkey_file, 'w') as f:
        f.write(key.spki())
    a.run_psibase(['create', name, '-k', pubkey_file] + a.node_args())
    a.wait(new_block())
    a.run_psibase(['modify', name, '-i', '--sign', key_file] + a.node_args())
    a.wait(new_block())


def websocket_url(node, path='/', service=None):
    url = urllib3.util.parse_url(node.url)
    if service is not None:
        host = service + '.' + url.host
    else:
        host = url.host
    return urllib3.util.Url('ws', url.auth, host, url.port, path).url


def _unix_connect(node, url, headers):
    kwargs = {'subprotocols': ['psibase.pslack.v1']}
    if headers:
        kwargs['additional_headers'] = headers
    return websockets.unix_connect(node.socketpath, url, **kwargs)


async def _read_json(ws):
    raw = await ws.recv()
    if isinstance(raw, bytes):
        raw = raw.decode()
    return json.loads(raw)


class TestPslack(unittest.TestCase):
    def _boot_with_pslack(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))
        a.boot(packages=['Minimal', 'Explorer', 'TokenUsers', 'AuthSig'])
        a.install_local(['XPSlack'])
        a.wait(new_block())
        return a

    async def _welcome(self, ws):
        msg = await _read_json(ws)
        self.assertEqual(msg.get('t'), 'welcome')
        return msg

    @testutil.psinode_test
    def test_ws_bearer_auth_login_path(self, cluster):
        """Integration coverage for JWT bearer on /ws (sender/auth path via real services)."""
        a = self._boot_with_pslack(cluster)
        tok = Transact(a).login('alice')
        url = websocket_url(a, '/ws', service='x-pslack')
        headers = [('Authorization', 'Bearer ' + tok)]

        async def body():
            async with _unix_connect(a, url, headers) as ws:
                w = await self._welcome(ws)
                self.assertEqual(w['user'], 'alice')

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_ws_unauthenticated_rejected(self, cluster):
        """Unauthenticated /ws upgrade must fail before application frames (401)."""
        a = self._boot_with_pslack(cluster)
        url = websocket_url(a, '/ws', service='x-pslack')

        async def body():
            async with _unix_connect(a, url, []):
                pass

        import asyncio
        with self.assertRaises(InvalidStatus) as cm:
            asyncio.run(body())
        self.assertEqual(cm.exception.response.status_code, 401)

    @testutil.psinode_test
    def test_sync_dm_message_and_presence(self, cluster):
        a = self._boot_with_pslack(cluster)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        url = websocket_url(a, '/ws', service='x-pslack')

        async def body():
            async with _unix_connect(a, url, [('Authorization', 'Bearer ' + ta)]) as ws_a, _unix_connect(
                a, url, [('Authorization', 'Bearer ' + tb)]
            ) as ws_b:
                await self._welcome(ws_a)
                await self._welcome(ws_b)

                await ws_a.send(json.dumps({'t': 'sync', 'knownConversationIds': []}))
                sa = await _read_json(ws_a)
                self.assertEqual(sa['t'], 'sync')
                self.assertEqual(sa['conversations'], [])

                await ws_a.send(json.dumps({'t': 'openDm', 'member': 'bob'}))
                conv_a = await _read_json(ws_a)
                self.assertEqual(conv_a['t'], 'conversation')
                cid = conv_a['conversationId']
                # Bob receives presence for alice (opened conversation + fanout)
                nb = await _read_json(ws_b)
                self.assertEqual(nb['t'], 'presence')
                self.assertEqual(nb['account'], 'alice')
                self.assertEqual(nb['status'], 'online')

                await ws_a.send(
                    json.dumps(
                        {
                            't': 'say',
                            'conversationId': cid,
                            'body': 'hi bob',
                            'clientMsgId': 'm1',
                        }
                    )
                )
                ma = await _read_json(ws_a)
                mb = await _read_json(ws_b)
                self.assertEqual(ma['t'], 'message')
                self.assertEqual(mb['t'], 'message')
                self.assertEqual(mb['body'], 'hi bob')
                self.assertEqual(mb['conversationId'], cid)
                self.assertEqual(mb['from'], 'alice')

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_group_fanout(self, cluster):
        a = self._boot_with_pslack(cluster)
        ck = PrivateKey()
        _create_signed_account(a, 'charliebbb1', ck)

        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        tc = Transact(a).login('charliebbb1', keys=[ck])
        url = websocket_url(a, '/ws', service='x-pslack')

        async def body():
            async with _unix_connect(a, url, [('Authorization', 'Bearer ' + ta)]) as ws_a, _unix_connect(
                a, url, [('Authorization', 'Bearer ' + tb)]
            ) as ws_b, _unix_connect(a, url, [('Authorization', 'Bearer ' + tc)]) as ws_c:
                await self._welcome(ws_a)
                await self._welcome(ws_b)
                await self._welcome(ws_c)

                await ws_a.send(
                    json.dumps({'t': 'openGroup', 'members': ['bob', 'charliebbb1']})
                )
                ca = await _read_json(ws_a)
                self.assertEqual(ca['t'], 'conversation')
                self.assertEqual(ca['kind'], 'group')
                cid = ca['conversationId']

                cb = await _read_json(ws_b)
                pb = await _read_json(ws_b)
                cc = await _read_json(ws_c)
                pc = await _read_json(ws_c)
                self.assertEqual(cb['t'], 'conversation')
                self.assertEqual(cb['kind'], 'group')
                self.assertEqual(cb['conversationId'], cid)
                self.assertEqual(pb['t'], 'presence')
                self.assertEqual(cc['t'], 'conversation')
                self.assertEqual(cc['kind'], 'group')
                self.assertEqual(cc['conversationId'], cid)
                self.assertEqual(pc['t'], 'presence')

                await ws_a.send(
                    json.dumps(
                        {
                            't': 'say',
                            'conversationId': cid,
                            'body': 'all hands',
                            'clientMsgId': 'g1',
                        }
                    )
                )
                frames = [await _read_json(ws_a), await _read_json(ws_b), await _read_json(ws_c)]
                self.assertEqual(len(frames), 3)
                for f in frames:
                    self.assertEqual(f['t'], 'message')
                    self.assertEqual(f['body'], 'all hands')
                    self.assertEqual(f['conversationId'], cid)
                bodies_from = {f['from'] for f in frames}
                self.assertEqual(bodies_from, {'alice'})

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_targeted_message_retries_without_duplicate_recipient_delivery(self, cluster):
        a = self._boot_with_pslack(cluster)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        url = websocket_url(a, '/ws', service='x-pslack')

        async def body():
            async with _unix_connect(a, url, [('Authorization', 'Bearer ' + ta)]) as ws_a:
                await self._welcome(ws_a)

                await ws_a.send(json.dumps({'t': 'openDm', 'member': 'bob'}))
                conv = await _read_json(ws_a)
                self.assertEqual(conv['t'], 'conversation')
                cid = conv['conversationId']

                await ws_a.send(
                    json.dumps(
                        {
                            't': 'say',
                            'conversationId': cid,
                            'body': 'queued for bob',
                            'clientMsgId': 'retry-1',
                            'clientTime': 1234,
                            'to': 'bob',
                        }
                    )
                )
                with self.assertRaises(TimeoutError):
                    await asyncio.wait_for(_read_json(ws_a), timeout=0.2)

                async with _unix_connect(a, url, [('Authorization', 'Bearer ' + tb)]) as ws_b:
                    await self._welcome(ws_b)
                    presence = await _read_json(ws_a)
                    self.assertEqual(presence['t'], 'presence')
                    self.assertEqual(presence['account'], 'bob')
                    self.assertEqual(presence['status'], 'online')

                    await ws_a.send(
                        json.dumps(
                            {
                                't': 'say',
                                'conversationId': cid,
                                'body': 'queued for bob',
                                'clientMsgId': 'retry-1',
                                'clientTime': 1234,
                                'to': 'bob',
                            }
                        )
                    )
                    ack_a = await _read_json(ws_a)
                    msg_b = await _read_json(ws_b)
                    self.assertEqual(ack_a['t'], 'message')
                    self.assertEqual(ack_a['to'], 'bob')
                    self.assertEqual(ack_a['clientTime'], 1234)
                    self.assertEqual(msg_b['t'], 'message')
                    self.assertEqual(msg_b['body'], 'queued for bob')
                    self.assertEqual(msg_b['to'], 'bob')

                    await ws_a.send(
                        json.dumps(
                            {
                                't': 'say',
                                'conversationId': cid,
                                'body': 'queued for bob',
                                'clientMsgId': 'retry-1',
                                'clientTime': 1234,
                                'to': 'bob',
                            }
                        )
                    )
                    dup_ack = await _read_json(ws_a)
                    self.assertEqual(dup_ack['t'], 'message')
                    with self.assertRaises(TimeoutError):
                        await asyncio.wait_for(_read_json(ws_b), timeout=0.2)

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_non_member_say_rejected(self, cluster):
        a = self._boot_with_pslack(cluster)
        ck = PrivateKey()
        _create_signed_account(a, 'charliebbb1', ck)

        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        tc = Transact(a).login('charliebbb1', keys=[ck])
        url = websocket_url(a, '/ws', service='x-pslack')

        async def body():
            async with _unix_connect(a, url, [('Authorization', 'Bearer ' + ta)]) as ws_a, _unix_connect(
                a, url, [('Authorization', 'Bearer ' + tb)]
            ) as ws_b, _unix_connect(a, url, [('Authorization', 'Bearer ' + tc)]) as ws_c:
                await self._welcome(ws_a)
                await self._welcome(ws_b)
                await self._welcome(ws_c)

                await ws_a.send(json.dumps({'t': 'openDm', 'member': 'bob'}))
                conv = await _read_json(ws_a)
                await _read_json(ws_b)  # presence
                cid = conv['conversationId']

                await ws_c.send(
                    json.dumps(
                        {
                            't': 'say',
                            'conversationId': cid,
                            'body': 'intruder',
                            'clientMsgId': 'x1',
                        }
                    )
                )
                err = await _read_json(ws_c)
                self.assertEqual(err['t'], 'error')
                self.assertEqual(err['code'], 'not-member')

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_conversation_isolation(self, cluster):
        a = self._boot_with_pslack(cluster)
        ck = PrivateKey()
        _create_signed_account(a, 'charliebbb1', ck)

        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        tc = Transact(a).login('charliebbb1', keys=[ck])
        url = websocket_url(a, '/ws', service='x-pslack')

        async def body():
            async with _unix_connect(a, url, [('Authorization', 'Bearer ' + ta)]) as ws_a, _unix_connect(
                a, url, [('Authorization', 'Bearer ' + tb)]
            ) as ws_b, _unix_connect(a, url, [('Authorization', 'Bearer ' + tc)]) as ws_c:
                await self._welcome(ws_a)
                await self._welcome(ws_b)
                await self._welcome(ws_c)

                await ws_a.send(json.dumps({'t': 'openDm', 'member': 'bob'}))
                ab = await _read_json(ws_a)
                await _read_json(ws_b)
                ab_id = ab['conversationId']

                await ws_a.send(json.dumps({'t': 'openDm', 'member': 'charliebbb1'}))
                ac = await _read_json(ws_a)
                await _read_json(ws_c)
                ac_id = ac['conversationId']
                self.assertNotEqual(ab_id, ac_id)

                await ws_a.send(
                    json.dumps(
                        {
                            't': 'say',
                            'conversationId': ac_id,
                            'body': 'for charlie only',
                            'clientMsgId': 'ac1',
                        }
                    )
                )
                await _read_json(ws_a)
                await _read_json(ws_c)

                await ws_b.send(
                    json.dumps(
                        {
                            't': 'say',
                            'conversationId': ac_id,
                            'body': 'bob not in this conv',
                            'clientMsgId': 'bad',
                        }
                    )
                )
                e = await _read_json(ws_b)
                self.assertEqual(e['t'], 'error')
                self.assertEqual(e['code'], 'not-member')

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_multi_socket_offline_presence(self, cluster):
        """Table-backed socket table: two sessions then staged disconnect → offline only after last close."""
        a = self._boot_with_pslack(cluster)
        tb = Transact(a).login('bob')
        ta = Transact(a).login('alice')
        url = websocket_url(a, '/ws', service='x-pslack')

        async def body():
            async with _unix_connect(a, url, [('Authorization', 'Bearer ' + ta)]) as ws_a1, _unix_connect(
                a, url, [('Authorization', 'Bearer ' + ta)]
            ) as ws_a2, _unix_connect(a, url, [('Authorization', 'Bearer ' + tb)]) as ws_b:
                await self._welcome(ws_a1)
                await self._welcome(ws_a2)
                await self._welcome(ws_b)

                await ws_a1.send(json.dumps({'t': 'openDm', 'member': 'bob'}))
                await _read_json(ws_a1)
                await _read_json(ws_b)

                await ws_b.send(json.dumps({'t': 'sync', 'knownConversationIds': []}))
                sync_b = await _read_json(ws_b)
                self.assertEqual(sync_b['t'], 'sync')
                ap = next(
                    (c for c in sync_b['contacts'] if c['account'] == 'alice'),
                    None,
                )
                self.assertIsNotNone(ap)
                self.assertEqual(ap['presence'], 'online')

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
                self.assertNotIn('socketCount', second)

        import asyncio
        asyncio.run(body())


if __name__ == '__main__':
    testutil.main()
