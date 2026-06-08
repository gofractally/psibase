#!/usr/bin/python

"""Integration tests for x-webrtcsig / Chat (T-006, T-021, T-055).

Supersedes legacy test_pslack*.py: auth, presence, chat-data and av-call
signaling delegate to x-webrtcsig (psibase.realtime.v1), not x-pslack.
"""

import json
import os
import sys
import testutil
import unittest
import urllib3
import websockets
from websockets.exceptions import InvalidStatus

from predicates import new_block
from psibase import MethodNumber
from services import Accounts, Transact
from fracpack import unpack

REALTIME_SUBPROTOCOL = 'psibase.realtime.v1'

# Local build output (override with PSIBASE_PACKAGE_DIR when running tests).
# The default assumes the standard `psibase/build/` layout; CMake passes an
# explicit PSIBASE_PACKAGE_DIR to remove ambiguity across in-source and
# out-of-source builds.
_DEFAULT_PACKAGE_DIR = os.path.join(
    os.path.dirname(__file__),
    '..', '..', '..', '..', '..',
    'build', 'share', 'psibase', 'packages',
)
PACKAGE_SOURCE = os.path.abspath(
    os.environ.get('PSIBASE_PACKAGE_DIR', _DEFAULT_PACKAGE_DIR)
)


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


async def _welcome_and_presence(ws):
    welcome = await _read_json(ws)
    assert welcome.get('t') == 'welcome'
    snapshot = await _read_json(ws)
    assert snapshot.get('t') == 'presenceSnapshot'
    return welcome


async def _client_ready(ws, instance_id):
    await ws.send(
        json.dumps(
            {
                't': 'clientReady',
                'clientInstanceId': instance_id,
                'active': True,
                'visible': True,
                'supports': {'audio': True, 'video': True, 'data': True},
            }
        )
    )


async def _read_until(ws, frame_type):
    """Read frames until one matches `frame_type` (skips other server frames)."""
    while True:
        msg = await _read_json(ws)
        if msg.get('t') == frame_type:
            return msg


async def _drain_online_presence(ws, max_peers=2):
    """Consume optional presence deltas after parallel connects (order varies)."""
    import asyncio

    for _ in range(max_peers):
        try:
            msg = await asyncio.wait_for(_read_json(ws), timeout=1.0)
        except asyncio.TimeoutError:
            break
        assert msg.get('t') == 'presence', msg
        assert msg.get('status') == 'online', msg


def _find_chat_action_trace(trace, method):
    """Return the ActionTrace inner node for `chat::<method>` (trace method names are lowercased)."""
    want = method.lower()

    def walk(nodes):
        for node in nodes:
            inner = node.get('inner', {})
            at = inner.get('ActionTrace')
            if at is not None:
                act = at['action']
                if act.get('service') == 'chat' and act.get('method', '').lower() == want:
                    yield inner
                yield from walk(at.get('innerTraces', []))
            elif isinstance(node, dict) and 'innerTraces' in node:
                yield from walk(node['innerTraces'])

    for top in trace['actionTraces']:
        found = next(walk(top.get('innerTraces', [])), None)
        if found is not None:
            return found
    return None


def _chat_action_return(node, trace, method):
    """Decode return value for a specific chat action (not auth wrapper traces)."""
    from psinode import ChainPackContext

    inner = _find_chat_action_trace(trace, method)
    if inner is None:
        raise AssertionError(f'no chat::{method} action trace in transaction')
    raw = inner['ActionTrace']['rawRetval']
    if not raw:
        raise AssertionError(f'chat::{method} returned empty rawRetval')
    result_ty = ChainPackContext(node).get_schema('chat').actions[MethodNumber(method)].result
    return unpack(bytes.fromhex(raw), result_ty)


# TokenUsers boot package only provisions these accounts.
_TOKEN_USER_ACCOUNTS = frozenset({'alice', 'bob'})
# Chain accounts must be >= 10 characters (TokenUsers' alice/bob are boot exceptions).
CAROL = 'carolcarol'
DAVE = 'davedaveee'


def _ensure_test_accounts(node, *accounts):
    """Create chain accounts not provisioned by TokenUsers boot."""
    extra = [name for name in accounts if name not in _TOKEN_USER_ACCOUNTS]
    if not extra:
        return
    accounts_svc = Accounts(node)
    for name in extra:
        accounts_svc.new_account(name)
    node.wait(new_block())


def _create_chat_data_session(node, alice='alice', bob='bob'):
    """Ensure DM space and chat-data session; return (space_uuid, session_id)."""
    dm_trace = node.push_action(alice, 'chat', 'ensureDm', {'contact': bob})
    dm = _chat_action_return(node, dm_trace, 'ensureDm')
    space_uuid = dm['space_uuid'] if isinstance(dm, dict) else dm.space_uuid
    node.wait(new_block())
    sess_trace = node.push_action(
        alice,
        'chat',
        'createSession',
        {
            'space_uuid': space_uuid,
            'purpose': 'chat-data',
            'participants': [alice, bob],
        },
    )
    session = _chat_action_return(node, sess_trace, 'createSession')
    session_id = (
        session['session_id'] if isinstance(session, dict) else session.session_id
    )
    node.wait(new_block())
    return space_uuid, session_id


def _create_group_chat_data_session(
    node, creator='alice', other_members=('bob', CAROL)
):
    """Ensure group Space and N-party chat-data session; return (space_uuid, session_id)."""
    _ensure_test_accounts(node, creator, *other_members)
    group_trace = node.push_action(
        creator,
        'chat',
        'ensureGroup',
        {'other_members': list(other_members)},
    )
    group = _chat_action_return(node, group_trace, 'ensureGroup')
    space_uuid = group['space_uuid'] if isinstance(group, dict) else group.space_uuid
    node.wait(new_block())
    participants = [creator, *other_members]
    sess_trace = node.push_action(
        creator,
        'chat',
        'createSession',
        {
            'space_uuid': space_uuid,
            'purpose': 'chat-data',
            'participants': participants,
        },
    )
    session = _chat_action_return(node, sess_trace, 'createSession')
    session_id = (
        session['session_id'] if isinstance(session, dict) else session.session_id
    )
    node.wait(new_block())
    return space_uuid, session_id


def _create_group_av_call_session(
    node, creator='alice', other_members=('bob', CAROL)
):
    """Ensure group Space and N-party av-call session; return (space_uuid, session_id)."""
    _ensure_test_accounts(node, creator, *other_members)
    group_trace = node.push_action(
        creator,
        'chat',
        'ensureGroup',
        {'other_members': list(other_members)},
    )
    group = _chat_action_return(node, group_trace, 'ensureGroup')
    space_uuid = group['space_uuid'] if isinstance(group, dict) else group.space_uuid
    node.wait(new_block())
    participants = [creator, *other_members]
    sess_trace = node.push_action(
        creator,
        'chat',
        'createSession',
        {
            'space_uuid': space_uuid,
            'purpose': 'av-call',
            'participants': participants,
        },
    )
    session = _chat_action_return(node, sess_trace, 'createSession')
    session_id = (
        session['session_id'] if isinstance(session, dict) else session.session_id
    )
    node.wait(new_block())
    return space_uuid, session_id


def _create_av_call_session(node, alice='alice', bob='bob'):
    """Ensure DM space and av-call session; return (space_uuid, session_id)."""
    dm_trace = node.push_action(alice, 'chat', 'ensureDm', {'contact': bob})
    dm = _chat_action_return(node, dm_trace, 'ensureDm')
    space_uuid = dm['space_uuid'] if isinstance(dm, dict) else dm.space_uuid
    node.wait(new_block())
    sess_trace = node.push_action(
        alice,
        'chat',
        'createSession',
        {
            'space_uuid': space_uuid,
            'purpose': 'av-call',
            'participants': [alice, bob],
        },
    )
    session = _chat_action_return(node, sess_trace, 'createSession')
    session_id = (
        session['session_id'] if isinstance(session, dict) else session.session_id
    )
    node.wait(new_block())
    return space_uuid, session_id


def _commit_webrtc_session_event(node, sender, session_id, kind, reason):
    """Record objective timeline event after x-webrtcsig join/leave (M5)."""
    node.push_action(
        sender,
        'chat',
        'commitWebRtcSessionEvent',
        {'session_id': session_id, 'kind': kind, 'reason': reason},
    )
    node.wait(new_block())


class TestXWebRtcSig(unittest.TestCase):
    def _install_local_packages(self, node, packages):
        """Install chain packages from PACKAGE_SOURCE; only XWebRtcSig uses --local."""
        chain = [p for p in packages if p != 'XWebRtcSig']
        if chain:
            node.install(chain, sources=[PACKAGE_SOURCE])
        if 'XWebRtcSig' in packages:
            # Always pick up freshly built service wasm during iterative dev.
            node.run_psibase(
                ['install', '--local', '--reinstall']
                + node.node_args()
                + ['--package-source=' + PACKAGE_SOURCE, 'XWebRtcSig']
            )

    def _boot_with_webrtcsig(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))
        a.boot(packages=['Minimal', 'Explorer', 'TokenUsers', 'AuthSig'])
        self._install_local_packages(a, ['XWebRtcSig'])
        a.wait(new_block())
        return a

    def _boot_with_chat_and_sig(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))
        a.boot(packages=['Minimal', 'Explorer', 'TokenUsers', 'AuthSig'])
        self._install_local_packages(a, ['Chat', 'XWebRtcSig'])
        a.push_action('root', 'chat', 'init', {})
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

    @testutil.psinode_test
    def test_chat_data_join_session_invite(self, cluster):
        """Authorized participant joinSession receives chat-data sessionInvite."""
        a = self._boot_with_chat_and_sig(cluster)
        _space_uuid, session_id = _create_chat_data_session(a)
        ta = Transact(a).login('alice')
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            async with _unix_connect(a, url, [('Authorization', 'Bearer ' + ta)]) as ws:
                await _welcome_and_presence(ws)
                await ws.send(
                    json.dumps(
                        {
                            't': 'joinSession',
                            'sessionId': session_id,
                            'clientInstanceId': 'alice-tab-1',
                        }
                    )
                )
                invite = await _read_json(ws)
                self.assertEqual(invite['t'], 'sessionInvite')
                self.assertEqual(invite['sessionId'], session_id)
                self.assertEqual(invite['appService'], 'chat')
                self.assertEqual(invite['purpose'], 'chat-data')
                self.assertEqual(len(invite['dataChannels']), 1)
                self.assertEqual(invite['dataChannels'][0]['label'], 'chat')
                self.assertTrue(invite['dataChannels'][0]['ordered'])
                self.assertIn('spaceUuid', invite.get('appMetadata', {}))

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_av_call_join_records_webrtc_session_event(self, cluster):
        """joinSession lifecycle wire-back invokes chat webrtcSessionEvent (§6.4)."""
        a = self._boot_with_chat_and_sig(cluster)
        _space_uuid, session_id = _create_av_call_session(a)
        tb = Transact(a).login('bob')
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            async with _unix_connect(a, url, [('Authorization', 'Bearer ' + tb)]) as ws:
                await _welcome_and_presence(ws)
                await ws.send(
                    json.dumps(
                        {
                            't': 'joinSession',
                            'sessionId': session_id,
                            'clientInstanceId': 'bob-tab-1',
                        }
                    )
                )
                invite = await _read_until(ws, 'sessionInvite')
                self.assertEqual(invite['purpose'], 'av-call')

        import asyncio
        asyncio.run(body())

        _commit_webrtc_session_event(a, 'bob', session_id, 1, 'joined')

        events_trace = a.push_action(
            'alice',
            'chat',
            'getCallEvents',
            {'session_id': session_id},
        )
        events = _chat_action_return(a, events_trace, 'getCallEvents')
        kinds = [
            row['kind'] if isinstance(row, dict) else row.kind for row in events
        ]
        self.assertIn(1, kinds)  # started
        self.assertIn(2, kinds)  # participant joined

    @testutil.psinode_test
    def test_chat_data_join_rejects_non_participant(self, cluster):
        """Non-participant joinSession is rejected; no chat bodies on websocket."""
        a = self._boot_with_chat_and_sig(cluster)
        _ensure_test_accounts(a, CAROL)
        _space_uuid, session_id = _create_chat_data_session(a)
        tc = Transact(a).login(CAROL)
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            async with _unix_connect(a, url, [('Authorization', 'Bearer ' + tc)]) as ws:
                await _welcome_and_presence(ws)
                await ws.send(
                    json.dumps(
                        {
                            't': 'joinSession',
                            'sessionId': session_id,
                            'clientInstanceId': 'carol-tab-1',
                        }
                    )
                )
                err = await _read_json(ws)
                self.assertEqual(err['t'], 'error')
                self.assertEqual(err['code'], 'not-participant')
                self.assertEqual(err['sessionId'], session_id)

                await ws.send(
                    json.dumps({'t': 'say', 'body': 'must not route chat on websocket'})
                )
                bad = await _read_json(ws)
                self.assertEqual(bad['t'], 'error')
                self.assertEqual(bad['code'], 'bad-frame')

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_chat_data_signal_relay(self, cluster):
        """joinSession on both peers then offer signal relays to the other socket."""
        a = self._boot_with_chat_and_sig(cluster)
        _space_uuid, session_id = _create_chat_data_session(a)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            async with _unix_connect(
                a, url, [('Authorization', 'Bearer ' + ta)]
            ) as ws_a, _unix_connect(
                a, url, [('Authorization', 'Bearer ' + tb)]
            ) as ws_b:
                await _welcome_and_presence(ws_a)
                await _welcome_and_presence(ws_b)
                await _client_ready(ws_a, 'alice-tab-1')
                await _client_ready(ws_b, 'bob-tab-1')
                await _read_json(ws_a)  # bob online to alice

                await ws_a.send(
                    json.dumps(
                        {
                            't': 'joinSession',
                            'sessionId': session_id,
                            'clientInstanceId': 'alice-tab-1',
                        }
                    )
                )
                invite_a = await _read_until(ws_a, 'sessionInvite')

                await ws_b.send(
                    json.dumps(
                        {
                            't': 'joinSession',
                            'sessionId': session_id,
                            'clientInstanceId': 'bob-tab-1',
                        }
                    )
                )
                invite_b = await _read_until(ws_b, 'sessionInvite')
                joined_a = await _read_json(ws_a)
                self.assertEqual(joined_a['t'], 'participantJoined')
                self.assertEqual(joined_a['participant'], 'bob')
                relay_invite = await _read_json(ws_a)
                self.assertEqual(relay_invite['t'], 'sessionInvite')
                self.assertEqual(relay_invite['from'], 'bob')

                await ws_a.send(
                    json.dumps(
                        {
                            't': 'signal',
                            'sessionId': session_id,
                            'to': 'bob',
                            'kind': 'offer',
                            'sdp': 'v=0',
                        }
                    )
                )
                signal_b = await _read_until(ws_b, 'signal')
                self.assertEqual(signal_b['t'], 'signal')
                self.assertEqual(signal_b['from'], 'alice')
                self.assertEqual(signal_b['to'], 'bob')
                self.assertEqual(signal_b['kind'], 'offer')
                self.assertEqual(signal_b['sdp'], 'v=0')

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_same_socket_can_join_multiple_pair_sessions(self, cluster):
        """One websocket can join multiple wrtc:pair:* sessions without aborting recv."""
        a = self._boot_with_chat_and_sig(cluster)
        _ensure_test_accounts(a, 'e2ealicegc', 'e2ecarolgc', 'daviddavid')
        token = Transact(a).login('e2ealicegc')
        pair_alice_carol = 'wrtc:pair:e2ealicegc:e2ecarolgc'
        pair_david_alice = 'wrtc:pair:daviddavid:e2ealicegc'
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            async with _unix_connect(a, url, [('Authorization', 'Bearer ' + token)]) as ws:
                await _welcome_and_presence(ws)
                await _client_ready(ws, 'alice-tab-1')

                await ws.send(
                    json.dumps(
                        {
                            't': 'joinSession',
                            'sessionId': pair_david_alice,
                            'clientInstanceId': 'alice-tab-1',
                        }
                    )
                )
                await _read_until(ws, 'sessionSnapshot')

                await ws.send(
                    json.dumps(
                        {
                            't': 'joinSession',
                            'sessionId': pair_alice_carol,
                            'clientInstanceId': 'alice-tab-1',
                        }
                    )
                )
                second_snap = await _read_until(ws, 'sessionSnapshot')
                self.assertEqual(second_snap['sessionId'], pair_alice_carol)
                self.assertIn('e2ealicegc', second_snap['joinedParticipants'])

                await ws.send(json.dumps({'t': 'ping'}))
                pong = await _read_until(ws, 'pong')
                self.assertEqual(pong['t'], 'pong')

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_pair_session_join_and_signal_relay(self, cluster):
        """Pair-only wrtc:pair:* sessions join and relay signals (e2e-style names)."""
        a = self._boot_with_chat_and_sig(cluster)
        _ensure_test_accounts(a, 'e2ealicegc', 'e2ecarolgc', 'daviddavid')
        ta = Transact(a).login('e2ealicegc')
        tb = Transact(a).login('e2ecarolgc')
        pair_alice_carol = 'wrtc:pair:e2ealicegc:e2ecarolgc'
        pair_david_alice = 'wrtc:pair:daviddavid:e2ealicegc'
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            async with _unix_connect(
                a, url, [('Authorization', 'Bearer ' + ta)]
            ) as ws_a, _unix_connect(
                a, url, [('Authorization', 'Bearer ' + tb)]
            ) as ws_c:
                await _welcome_and_presence(ws_a)
                await _welcome_and_presence(ws_c)
                await _client_ready(ws_a, 'alice-tab-1')
                await _client_ready(ws_c, 'carol-tab-1')

                # Alice joins david pair first, then carol pair (same socket).
                await ws_a.send(
                    json.dumps(
                        {
                            't': 'joinSession',
                            'sessionId': pair_david_alice,
                            'clientInstanceId': 'alice-tab-1',
                        }
                    )
                )
                david_invite = await _read_until(ws_a, 'sessionInvite')
                self.assertEqual(david_invite['sessionId'], pair_david_alice)
                await _read_until(ws_a, 'sessionSnapshot')

                await ws_a.send(
                    json.dumps(
                        {
                            't': 'joinSession',
                            'sessionId': pair_alice_carol,
                            'clientInstanceId': 'alice-tab-1',
                        }
                    )
                )
                carol_invite = await _read_until(ws_a, 'sessionInvite')
                self.assertEqual(carol_invite['sessionId'], pair_alice_carol)
                alice_snap = await _read_until(ws_a, 'sessionSnapshot')
                self.assertEqual(alice_snap['sessionId'], pair_alice_carol)
                self.assertIn('e2ealicegc', alice_snap['joinedParticipants'])

                await ws_c.send(
                    json.dumps(
                        {
                            't': 'joinSession',
                            'sessionId': pair_alice_carol,
                            'clientInstanceId': 'carol-tab-1',
                        }
                    )
                )
                await _read_until(ws_c, 'sessionInvite')
                carol_snap = await _read_until(ws_c, 'sessionSnapshot')
                self.assertIn('e2ecarolgc', carol_snap['joinedParticipants'])
                self.assertIn('e2ealicegc', carol_snap['joinedParticipants'])

                await ws_a.send(
                    json.dumps(
                        {
                            't': 'signal',
                            'sessionId': pair_alice_carol,
                            'to': 'e2ecarolgc',
                            'kind': 'offer',
                            'sdp': 'v=0',
                        }
                    )
                )
                signal_c = await _read_until(ws_c, 'signal')
                self.assertEqual(signal_c['from'], 'e2ealicegc')
                self.assertEqual(signal_c['to'], 'e2ecarolgc')

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_group_chat_data_join_three_party_invite(self, cluster):
        """N-party group joinSession returns sessionInvite with all participants."""
        a = self._boot_with_chat_and_sig(cluster)
        space_uuid, session_id = _create_group_chat_data_session(a)
        ta = Transact(a).login('alice')
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            async with _unix_connect(a, url, [('Authorization', 'Bearer ' + ta)]) as ws:
                await _welcome_and_presence(ws)
                await ws.send(
                    json.dumps(
                        {
                            't': 'joinSession',
                            'sessionId': session_id,
                            'clientInstanceId': 'alice-tab-1',
                        }
                    )
                )
                invite = await _read_json(ws)
                self.assertEqual(invite['t'], 'sessionInvite')
                self.assertEqual(invite['sessionId'], session_id)
                self.assertEqual(invite['appService'], 'chat')
                self.assertEqual(invite['purpose'], 'chat-data')
                self.assertEqual(len(invite['participants']), 3)
                self.assertEqual(
                    sorted(invite['participants']),
                    sorted(['alice', 'bob', CAROL]),
                )
                self.assertEqual(len(invite['dataChannels']), 1)
                self.assertEqual(invite['dataChannels'][0]['label'], 'chat')
                self.assertTrue(invite['dataChannels'][0]['ordered'])
                self.assertEqual(
                    invite.get('appMetadata', {}).get('spaceUuid'),
                    space_uuid,
                )

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_group_chat_data_join_rejects_non_participant(self, cluster):
        """Non-member cannot join N-party group chat-data session."""
        a = self._boot_with_chat_and_sig(cluster)
        _ensure_test_accounts(a, DAVE)
        _space_uuid, session_id = _create_group_chat_data_session(a)
        td = Transact(a).login(DAVE)
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            async with _unix_connect(a, url, [('Authorization', 'Bearer ' + td)]) as ws:
                await _welcome_and_presence(ws)
                await ws.send(
                    json.dumps(
                        {
                            't': 'joinSession',
                            'sessionId': session_id,
                            'clientInstanceId': 'dave-tab-1',
                        }
                    )
                )
                err = await _read_json(ws)
                self.assertEqual(err['t'], 'error')
                self.assertEqual(err['code'], 'not-participant')
                self.assertEqual(err['sessionId'], session_id)

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_group_chat_data_signal_mesh_relay(self, cluster):
        """Three peers join; SDP/ICE signals relay to each session participant."""
        a = self._boot_with_chat_and_sig(cluster)
        _space_uuid, session_id = _create_group_chat_data_session(a)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        tc = Transact(a).login(CAROL)
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def join(ws, user, instance_id):
            await ws.send(
                json.dumps(
                    {
                        't': 'joinSession',
                        'sessionId': session_id,
                        'clientInstanceId': instance_id,
                    }
                )
            )
            return await _read_until(ws, 'sessionInvite')

        async def signal(ws, sender, to, sdp):
            await ws.send(
                json.dumps(
                    {
                        't': 'signal',
                        'sessionId': session_id,
                        'to': to,
                        'kind': 'offer',
                        'sdp': sdp,
                    }
                )
            )

        async def expect_signal(ws, from_user, to_user, sdp):
            frame = await _read_until(ws, 'signal')
            self.assertEqual(frame['from'], from_user)
            self.assertEqual(frame['to'], to_user)
            self.assertEqual(frame['kind'], 'offer')
            self.assertEqual(frame['sdp'], sdp)

        async def body():
            async with _unix_connect(
                a, url, [('Authorization', 'Bearer ' + ta)]
            ) as ws_a, _unix_connect(
                a, url, [('Authorization', 'Bearer ' + tb)]
            ) as ws_b, _unix_connect(
                a, url, [('Authorization', 'Bearer ' + tc)]
            ) as ws_c:
                await _welcome_and_presence(ws_a)
                await _welcome_and_presence(ws_b)
                await _welcome_and_presence(ws_c)
                await _client_ready(ws_a, 'alice-tab-1')
                await _client_ready(ws_b, 'bob-tab-1')
                await _client_ready(ws_c, 'carol-tab-1')
                await _drain_online_presence(ws_a, max_peers=2)

                await join(ws_a, 'alice', 'alice-tab-1')
                await join(ws_b, 'bob', 'bob-tab-1')
                joined_b = await _read_until(ws_a, 'participantJoined')
                self.assertEqual(joined_b['participant'], 'bob')
                relay_b = await _read_until(ws_a, 'sessionInvite')
                self.assertEqual(relay_b.get('from'), 'bob')

                await join(ws_c, CAROL, 'carol-tab-1')
                joined_c = await _read_until(ws_a, 'participantJoined')
                self.assertEqual(joined_c['participant'], CAROL)
                relay_c = await _read_until(ws_a, 'sessionInvite')
                self.assertEqual(relay_c.get('from'), CAROL)

                await signal(ws_a, 'alice', 'bob', 'offer-a-b')
                await expect_signal(ws_b, 'alice', 'bob', 'offer-a-b')

                await signal(ws_a, 'alice', CAROL, 'offer-a-c')
                await expect_signal(ws_c, 'alice', CAROL, 'offer-a-c')

                await signal(ws_b, 'bob', CAROL, 'offer-b-c')
                await expect_signal(ws_c, 'bob', CAROL, 'offer-b-c')

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_group_chat_data_signal_rejects_non_participant(self, cluster):
        """Non-member cannot signal in N-party group chat-data session."""
        a = self._boot_with_chat_and_sig(cluster)
        _ensure_test_accounts(a, DAVE)
        _space_uuid, session_id = _create_group_chat_data_session(a)
        ta = Transact(a).login('alice')
        td = Transact(a).login(DAVE)
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            async with _unix_connect(
                a, url, [('Authorization', 'Bearer ' + ta)]
            ) as ws_a, _unix_connect(
                a, url, [('Authorization', 'Bearer ' + td)]
            ) as ws_d:
                await _welcome_and_presence(ws_a)
                await _welcome_and_presence(ws_d)
                await _client_ready(ws_a, 'alice-tab-1')
                await _client_ready(ws_d, 'dave-tab-1')
                await _drain_online_presence(ws_a, max_peers=1)

                await ws_a.send(
                    json.dumps(
                        {
                            't': 'joinSession',
                            'sessionId': session_id,
                            'clientInstanceId': 'alice-tab-1',
                        }
                    )
                )
                await _read_until(ws_a, 'sessionInvite')

                await ws_d.send(
                    json.dumps(
                        {
                            't': 'signal',
                            'sessionId': session_id,
                            'to': 'alice',
                            'kind': 'offer',
                            'sdp': 'v=0',
                        }
                    )
                )
                err = await _read_json(ws_d)
                self.assertEqual(err['t'], 'error')
                self.assertEqual(err['code'], 'not-participant')
                self.assertEqual(err['sessionId'], session_id)

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_group_av_call_join_three_party_invite(self, cluster):
        """N-party av-call joinSession returns sessionInvite with audio/video transports."""
        a = self._boot_with_chat_and_sig(cluster)
        space_uuid, session_id = _create_group_av_call_session(a)
        ta = Transact(a).login('alice')
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            async with _unix_connect(a, url, [('Authorization', 'Bearer ' + ta)]) as ws:
                await _welcome_and_presence(ws)
                await ws.send(
                    json.dumps(
                        {
                            't': 'joinSession',
                            'sessionId': session_id,
                            'clientInstanceId': 'alice-tab-1',
                        }
                    )
                )
                invite = await _read_json(ws)
                self.assertEqual(invite['t'], 'sessionInvite')
                self.assertEqual(invite['sessionId'], session_id)
                self.assertEqual(invite['appService'], 'chat')
                self.assertEqual(invite['purpose'], 'av-call')
                self.assertEqual(len(invite['participants']), 3)
                self.assertEqual(
                    sorted(invite['participants']),
                    sorted(['alice', 'bob', CAROL]),
                )
                self.assertEqual(invite['transports'], ['audio', 'video'])
                self.assertEqual(invite['dataChannels'], [])
                self.assertEqual(
                    invite.get('appMetadata', {}).get('spaceUuid'),
                    space_uuid,
                )

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_group_av_call_join_rejects_non_participant(self, cluster):
        """Non-member cannot join N-party group av-call session."""
        a = self._boot_with_chat_and_sig(cluster)
        _ensure_test_accounts(a, DAVE)
        _space_uuid, session_id = _create_group_av_call_session(a)
        td = Transact(a).login(DAVE)
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            async with _unix_connect(a, url, [('Authorization', 'Bearer ' + td)]) as ws:
                await _welcome_and_presence(ws)
                await ws.send(
                    json.dumps(
                        {
                            't': 'joinSession',
                            'sessionId': session_id,
                            'clientInstanceId': 'dave-tab-1',
                        }
                    )
                )
                err = await _read_json(ws)
                self.assertEqual(err['t'], 'error')
                self.assertEqual(err['code'], 'not-participant')
                self.assertEqual(err['sessionId'], session_id)

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_group_av_call_signal_mesh_relay(self, cluster):
        """Three peers join av-call; SDP/ICE signals relay among session participants."""
        a = self._boot_with_chat_and_sig(cluster)
        _space_uuid, session_id = _create_group_av_call_session(a)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        tc = Transact(a).login(CAROL)
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def join(ws, user, instance_id):
            await ws.send(
                json.dumps(
                    {
                        't': 'joinSession',
                        'sessionId': session_id,
                        'clientInstanceId': instance_id,
                    }
                )
            )
            return await _read_until(ws, 'sessionInvite')

        async def signal(ws, sender, to, sdp):
            await ws.send(
                json.dumps(
                    {
                        't': 'signal',
                        'sessionId': session_id,
                        'to': to,
                        'kind': 'offer',
                        'sdp': sdp,
                    }
                )
            )

        async def expect_signal(ws, from_user, to_user, sdp):
            frame = await _read_until(ws, 'signal')
            self.assertEqual(frame['from'], from_user)
            self.assertEqual(frame['to'], to_user)
            self.assertEqual(frame['kind'], 'offer')
            self.assertEqual(frame['sdp'], sdp)

        async def body():
            async with _unix_connect(
                a, url, [('Authorization', 'Bearer ' + ta)]
            ) as ws_a, _unix_connect(
                a, url, [('Authorization', 'Bearer ' + tb)]
            ) as ws_b, _unix_connect(
                a, url, [('Authorization', 'Bearer ' + tc)]
            ) as ws_c:
                await _welcome_and_presence(ws_a)
                await _welcome_and_presence(ws_b)
                await _welcome_and_presence(ws_c)
                await _client_ready(ws_a, 'alice-tab-1')
                await _client_ready(ws_b, 'bob-tab-1')
                await _client_ready(ws_c, 'carol-tab-1')
                await _drain_online_presence(ws_a, max_peers=2)

                await join(ws_a, 'alice', 'alice-tab-1')
                await join(ws_b, 'bob', 'bob-tab-1')
                joined_b = await _read_until(ws_a, 'participantJoined')
                self.assertEqual(joined_b['participant'], 'bob')
                relay_b = await _read_until(ws_a, 'sessionInvite')
                self.assertEqual(relay_b.get('from'), 'bob')
                self.assertEqual(relay_b['purpose'], 'av-call')
                self.assertEqual(relay_b['transports'], ['audio', 'video'])

                await join(ws_c, CAROL, 'carol-tab-1')
                joined_c = await _read_until(ws_a, 'participantJoined')
                self.assertEqual(joined_c['participant'], CAROL)
                relay_c = await _read_until(ws_a, 'sessionInvite')
                self.assertEqual(relay_c.get('from'), CAROL)
                self.assertEqual(relay_c['purpose'], 'av-call')

                await signal(ws_a, 'alice', 'bob', 'offer-a-b')
                await expect_signal(ws_b, 'alice', 'bob', 'offer-a-b')

                await signal(ws_a, 'alice', CAROL, 'offer-a-c')
                await expect_signal(ws_c, 'alice', CAROL, 'offer-a-c')

                await signal(ws_b, 'bob', CAROL, 'offer-b-c')
                await expect_signal(ws_c, 'bob', CAROL, 'offer-b-c')

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_av_call_leave_session_end_event(self, cluster):
        """leaveSession on av-call triggers sessionEnded fanout and chat lifecycle."""
        a = self._boot_with_chat_and_sig(cluster)
        _space_uuid, session_id = _create_av_call_session(a)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            async with _unix_connect(
                a, url, [('Authorization', 'Bearer ' + ta)]
            ) as ws_a, _unix_connect(
                a, url, [('Authorization', 'Bearer ' + tb)]
            ) as ws_b:
                await _welcome_and_presence(ws_a)
                await _welcome_and_presence(ws_b)
                await _client_ready(ws_a, 'alice-tab-1')
                await _client_ready(ws_b, 'bob-tab-1')
                await _drain_online_presence(ws_a, max_peers=1)

                for ws, inst in ((ws_a, 'alice-tab-1'), (ws_b, 'bob-tab-1')):
                    await ws.send(
                        json.dumps(
                            {
                                't': 'joinSession',
                                'sessionId': session_id,
                                'clientInstanceId': inst,
                            }
                        )
                    )
                    await _read_until(ws, 'sessionInvite')

                await _read_until(ws_a, 'participantJoined')
                await _read_until(ws_a, 'sessionInvite')

                await ws_a.send(
                    json.dumps(
                        {
                            't': 'leaveSession',
                            'sessionId': session_id,
                            'reason': 'ended',
                        }
                    )
                )
                ended = await _read_until(ws_b, 'sessionEnded')
                self.assertEqual(ended['sessionId'], session_id)
                self.assertEqual(ended.get('reason'), 'ended')

        import asyncio
        asyncio.run(body())

        _commit_webrtc_session_event(a, 'alice', session_id, 4, 'ended')

        session_trace = a.push_action(
            'alice',
            'chat',
            'getSession',
            {'session_id': session_id},
        )
        session = _chat_action_return(a, session_trace, 'getSession')
        lifecycle = session['lifecycle'] if isinstance(session, dict) else session.lifecycle
        self.assertEqual(lifecycle, 2)

    @testutil.psinode_test
    def test_av_call_socket_close_while_ringing_notifies_peer(self, cluster):
        """Caller websocket close during ringing fans out transport sessionEnded."""
        a = self._boot_with_chat_and_sig(cluster)
        _space_uuid, session_id = _create_av_call_session(a)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            import asyncio

            async with _unix_connect(
                a, url, [('Authorization', 'Bearer ' + tb)]
            ) as ws_b:
                await _welcome_and_presence(ws_b)
                await _client_ready(ws_b, 'bob-tab-1')

                async with _unix_connect(
                    a, url, [('Authorization', 'Bearer ' + ta)]
                ) as ws_a:
                    await _welcome_and_presence(ws_a)
                    await _client_ready(ws_a, 'alice-tab-1')
                    await _drain_online_presence(ws_b, max_peers=1)

                    await ws_a.send(
                        json.dumps(
                            {
                                't': 'joinSession',
                                'sessionId': session_id,
                                'clientInstanceId': 'alice-tab-1',
                            }
                        )
                    )
                    await _read_until(ws_a, 'sessionInvite')
                    await _read_until(ws_b, 'sessionInvite')

                ended = await _read_until(ws_b, 'sessionEnded')
                self.assertEqual(ended['sessionId'], session_id)
                self.assertEqual(ended.get('reason'), 'transport')

                await asyncio.sleep(0.05)

        import asyncio
        asyncio.run(body())

        _commit_webrtc_session_event(a, 'bob', session_id, 3, 'transport')

        session_trace = a.push_action(
            'alice',
            'chat',
            'getSession',
            {'session_id': session_id},
        )
        session = _chat_action_return(a, session_trace, 'getSession')
        lifecycle = session['lifecycle'] if isinstance(session, dict) else session.lifecycle
        self.assertEqual(lifecycle, 3)

    @testutil.psinode_test
    def test_chat_data_signal_before_join_rejected(self, cluster):
        """Signal before joinSession returns not-joined error."""
        a = self._boot_with_chat_and_sig(cluster)
        _space_uuid, session_id = _create_chat_data_session(a)
        ta = Transact(a).login('alice')
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            async with _unix_connect(a, url, [('Authorization', 'Bearer ' + ta)]) as ws:
                await _welcome_and_presence(ws)
                await ws.send(
                    json.dumps(
                        {
                            't': 'signal',
                            'sessionId': session_id,
                            'to': 'bob',
                            'kind': 'offer',
                            'sdp': 'v=0',
                        }
                    )
                )
                err = await _read_json(ws)
                self.assertEqual(err['t'], 'error')
                self.assertEqual(err['code'], 'not-joined')

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_chat_data_signal_buffered_until_recipient_joins(self, cluster):
        """Offer before recipient joinSession is buffered and flushed on join."""
        a = self._boot_with_chat_and_sig(cluster)
        _space_uuid, session_id = _create_chat_data_session(a)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            import asyncio

            async with _unix_connect(
                a, url, [('Authorization', 'Bearer ' + ta)]
            ) as ws_a:
                await _welcome_and_presence(ws_a)
                await _client_ready(ws_a, 'alice-tab-1')

                await ws_a.send(
                    json.dumps(
                        {
                            't': 'joinSession',
                            'sessionId': session_id,
                            'clientInstanceId': 'alice-tab-1',
                        }
                    )
                )
                await _read_until(ws_a, 'sessionInvite')

                # Send offer + two ICE candidates back-to-back. These all carry the
                # same block-time microsecond as the seq when they hit the queue,
                # so we exercise the PK collision regression for buffered signals.
                await ws_a.send(
                    json.dumps(
                        {
                            't': 'signal',
                            'sessionId': session_id,
                            'to': 'bob',
                            'kind': 'offer',
                            'sdp': 'v=0',
                        }
                    )
                )
                await ws_a.send(
                    json.dumps(
                        {
                            't': 'signal',
                            'sessionId': session_id,
                            'to': 'bob',
                            'kind': 'candidate',
                            'candidate': 'candidate:1 1 udp 1 127.0.0.1 1 typ host',
                            'sdpMid': '0',
                            'sdpMLineIndex': 0,
                        }
                    )
                )
                await ws_a.send(
                    json.dumps(
                        {
                            't': 'signal',
                            'sessionId': session_id,
                            'to': 'bob',
                            'kind': 'candidate',
                            'candidate': 'candidate:2 1 udp 2 127.0.0.1 2 typ host',
                            'sdpMid': '0',
                            'sdpMLineIndex': 0,
                        }
                    )
                )
                try:
                    maybe_trace = await asyncio.wait_for(_read_json(ws_a), timeout=1.0)
                except asyncio.TimeoutError:
                    maybe_trace = {}
                # Buffered signals no longer emit a client-visible signal-trace error.
                self.assertNotEqual(maybe_trace.get('code'), 'signal-trace')

                async with _unix_connect(
                    a, url, [('Authorization', 'Bearer ' + tb)]
                ) as ws_b:
                    await _welcome_and_presence(ws_b)
                    await _client_ready(ws_b, 'bob-tab-1')
                    await ws_b.send(
                        json.dumps(
                            {
                                't': 'joinSession',
                                'sessionId': session_id,
                                'clientInstanceId': 'bob-tab-1',
                            }
                        )
                    )
                    await _read_until(ws_b, 'sessionInvite')

                    # All three buffered signals must be flushed in enqueue order.
                    signals = []
                    for _ in range(3):
                        signals.append(await _read_until(ws_b, 'signal'))

                    self.assertEqual(
                        [(s['kind'], s.get('candidate')) for s in signals],
                        [
                            ('offer', None),
                            (
                                'candidate',
                                'candidate:1 1 udp 1 127.0.0.1 1 typ host',
                            ),
                            (
                                'candidate',
                                'candidate:2 1 udp 2 127.0.0.1 2 typ host',
                            ),
                        ],
                    )
                    for s in signals:
                        self.assertEqual(s['from'], 'alice')

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_av_call_websocket_rejects_chat_and_media_payloads(self, cluster):
        """Av-call session websocket carries signaling only — no chat or legacy media frames."""
        a = self._boot_with_chat_and_sig(cluster)
        _space_uuid, session_id = _create_av_call_session(a)
        ta = Transact(a).login('alice')
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            async with _unix_connect(a, url, [('Authorization', 'Bearer ' + ta)]) as ws:
                await _welcome_and_presence(ws)
                await ws.send(
                    json.dumps(
                        {
                            't': 'joinSession',
                            'sessionId': session_id,
                            'clientInstanceId': 'alice-tab-1',
                        }
                    )
                )
                invite = await _read_until(ws, 'sessionInvite')
                self.assertEqual(invite['purpose'], 'av-call')
                self.assertEqual(invite['transports'], ['audio', 'video'])
                self.assertEqual(invite['dataChannels'], [])

                for payload in (
                    {'t': 'say', 'body': 'must not route chat on websocket'},
                    {
                        't': 'chatMessage',
                        'spaceUuid': 'space:1',
                        'from': 'alice',
                        'body': 'hi',
                        'sendTimestamp': 1,
                        'clientMsgId': 'm1',
                    },
                    {
                        't': 'callMediaState',
                        'callId': session_id,
                        'audioMuted': True,
                        'videoMuted': False,
                    },
                ):
                    await ws.send(json.dumps(payload))
                    err = await _read_json(ws)
                    self.assertEqual(err['t'], 'error')
                    self.assertEqual(err['code'], 'bad-frame')

        import asyncio
        asyncio.run(body())


class TestChatDataP2pHarness(TestXWebRtcSig):
    @testutil.psinode_test
    def test_welcome_ice_servers_stun_only_no_turn(self, cluster):
        """Document default welcome: STUN without TURN (browser uses host-only ICE)."""
        a = self._boot_with_webrtcsig(cluster)
        tok = Transact(a).login('alice')
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            async with _unix_connect(a, url, [('Authorization', 'Bearer ' + tok)]) as ws:
                w = await self._welcome(ws)
                servers = w.get('iceServers') or []
                self.assertGreater(len(servers), 0)
                for entry in servers:
                    urls = entry.get('urls') or []
                    if isinstance(urls, str):
                        urls = [urls]
                    for u in urls:
                        self.assertFalse(
                            u.startswith('turn:') or u.startswith('turns:'),
                            f'unexpected TURN in default welcome: {u}',
                        )

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_chat_data_p2p_webrtc_aiortc(self, cluster):
        """Headless aiortc peers open DM datachannels on both sides (host-only ICE)."""
        from chat_data_p2p_aiortc import aiortc_available, run_chat_data_p2p

        if not aiortc_available():
            self.skipTest('pip install aiortc')

        a = TestXWebRtcSig()._boot_with_chat_and_sig(cluster)
        _space_uuid, session_id = _create_chat_data_session(a)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            return await run_chat_data_p2p(
                unix_connect=lambda path, hdrs: _unix_connect(a, path, hdrs),
                url=url,
                session_id=session_id,
                alice='alice',
                bob='bob',
                token_alice=ta,
                token_bob=tb,
                use_host_only_ice=True,
            )

        import asyncio

        result = asyncio.run(body())
        self.assertTrue(
            result.get('ok'),
            'both peers must open datachannel (regression for browser pending messages): '
            + json.dumps(result, indent=2),
        )
        self.assertTrue(result['alice']['dataChannelOpen'])
        self.assertTrue(result['bob']['dataChannelOpen'])

    @testutil.psinode_test
    def test_chat_data_p2p_pending_flush_on_rejoin(self, cluster):
        """After bob closes and reopens his ws, alice's queued DM still flows on the new datachannel."""
        from chat_data_p2p_aiortc import (
            aiortc_available,
            run_chat_data_p2p_pending_flush_on_rejoin,
        )

        if not aiortc_available():
            self.skipTest('pip install aiortc')

        a = TestXWebRtcSig()._boot_with_chat_and_sig(cluster)
        _space_uuid, session_id = _create_chat_data_session(a)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            return await run_chat_data_p2p_pending_flush_on_rejoin(
                unix_connect=lambda path, hdrs: _unix_connect(a, path, hdrs),
                url=url,
                session_id=session_id,
                alice='alice',
                bob='bob',
                token_alice=ta,
                token_bob=tb,
                use_host_only_ice=True,
            )

        import asyncio

        result = asyncio.run(body())
        self.assertTrue(
            result.get('initialDataChannelOk'),
            'baseline DM datachannel must open before rejoin: '
            + json.dumps(result, indent=2),
        )
        self.assertTrue(
            result.get('initialMessageDelivered'),
            'first DM should arrive on the initial datachannel: '
            + json.dumps(result, indent=2),
        )
        self.assertTrue(
            result.get('renegotiationOk'),
            'datachannel must reopen after bob rejoins: '
            + json.dumps(result, indent=2),
        )
        self.assertTrue(
            result.get('pendingDelivered'),
            "pending DM must flush after bob rejoins (covers the "
            "'alice keeps tab open, bob reopens chat' regression): "
            + json.dumps(result, indent=2),
        )

    @testutil.psinode_test
    def test_chat_data_p2p_group_three_party_roundtrip(self, cluster):
        """3-party mesh: each peer sends one chatMessage; all receive all (real aiortc)."""
        from chat_data_p2p_aiortc import (
            aiortc_available,
            run_chat_data_p2p_group_three_party_roundtrip,
        )

        if not aiortc_available():
            self.skipTest('pip install aiortc')

        a = TestXWebRtcSig()._boot_with_chat_and_sig(cluster)
        _ensure_test_accounts(a, CAROL)
        space_uuid, session_id = _create_group_chat_data_session(a)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        tc = Transact(a).login(CAROL)
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            return await run_chat_data_p2p_group_three_party_roundtrip(
                unix_connect=lambda path, hdrs: _unix_connect(a, path, hdrs),
                url=url,
                session_id=session_id,
                space_uuid=space_uuid,
                alice='alice',
                bob='bob',
                carol=CAROL,
                token_alice=ta,
                token_bob=tb,
                token_carol=tc,
                use_host_only_ice=True,
            )

        import asyncio

        result = asyncio.run(body())
        self.assertTrue(
            result.get('meshOk'),
            '3-party mesh must negotiate: ' + json.dumps(result, indent=2),
        )
        self.assertTrue(
            result.get('ok'),
            'each peer must receive all group messages: '
            + json.dumps(result, indent=2),
        )

    @testutil.psinode_test
    def test_chat_data_p2p_group_offline_member_catchup(self, cluster):
        """Alice leaves; Bob sends group msg; Carol receives; Alice rejoins and receives."""
        from chat_data_p2p_aiortc import (
            aiortc_available,
            run_chat_data_p2p_group_offline_member_catchup,
        )

        if not aiortc_available():
            self.skipTest('pip install aiortc')

        a = TestXWebRtcSig()._boot_with_chat_and_sig(cluster)
        _ensure_test_accounts(a, CAROL)
        space_uuid, session_id = _create_group_chat_data_session(a)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        tc = Transact(a).login(CAROL)
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            return await run_chat_data_p2p_group_offline_member_catchup(
                unix_connect=lambda path, hdrs: _unix_connect(a, path, hdrs),
                url=url,
                session_id=session_id,
                space_uuid=space_uuid,
                alice='alice',
                bob='bob',
                carol=CAROL,
                token_alice=ta,
                token_bob=tb,
                token_carol=tc,
                use_host_only_ice=True,
            )

        import asyncio

        result = asyncio.run(body())
        self.assertTrue(
            result.get('initialMeshOk'),
            'baseline mesh must be up: ' + json.dumps(result, indent=2),
        )
        self.assertTrue(
            result.get('carolReceivedWhileAliceAway'),
            'carol must receive while alice is away: '
            + json.dumps(result, indent=2),
        )
        self.assertTrue(
            result.get('aliceReceivedAfterRejoin'),
            'alice must receive pending flush after rejoin (M4 #4): '
            + json.dumps(result, indent=2),
        )

    @testutil.psinode_test
    def test_chat_data_p2p_group_pending_before_peers_open(self, cluster):
        """Alice queues group message before Bob/Carol join; delivers when mesh ready."""
        from chat_data_p2p_aiortc import (
            aiortc_available,
            run_chat_data_p2p_group_pending_before_peers_open,
        )

        if not aiortc_available():
            self.skipTest('pip install aiortc')

        a = TestXWebRtcSig()._boot_with_chat_and_sig(cluster)
        _ensure_test_accounts(a, CAROL)
        space_uuid, session_id = _create_group_chat_data_session(a)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        tc = Transact(a).login(CAROL)
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            return await run_chat_data_p2p_group_pending_before_peers_open(
                unix_connect=lambda path, hdrs: _unix_connect(a, path, hdrs),
                url=url,
                session_id=session_id,
                space_uuid=space_uuid,
                alice='alice',
                bob='bob',
                carol=CAROL,
                token_alice=ta,
                token_bob=tb,
                token_carol=tc,
                use_host_only_ice=True,
            )

        import asyncio

        result = asyncio.run(body())
        self.assertTrue(
            result.get('ok'),
            'pending group message must flush when peers open thread: '
            + json.dumps(result, indent=2),
        )

    @testutil.psinode_test
    def test_group_chat_data_join_out_of_order(self, cluster):
        """C joins before B before A; all receive sessionInvite with full roster."""
        a = self._boot_with_chat_and_sig(cluster)
        _space_uuid, session_id = _create_group_chat_data_session(a)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        tc = Transact(a).login(CAROL)
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def join(ws, instance_id):
            await ws.send(
                json.dumps(
                    {
                        't': 'joinSession',
                        'sessionId': session_id,
                        'clientInstanceId': instance_id,
                    }
                )
            )
            return await _read_until(ws, 'sessionInvite')

        async def body():
            async with _unix_connect(
                a, url, [('Authorization', 'Bearer ' + tc)]
            ) as ws_c, _unix_connect(
                a, url, [('Authorization', 'Bearer ' + tb)]
            ) as ws_b, _unix_connect(
                a, url, [('Authorization', 'Bearer ' + ta)]
            ) as ws_a:
                await _welcome_and_presence(ws_c)
                await _welcome_and_presence(ws_b)
                await _welcome_and_presence(ws_a)
                await _client_ready(ws_c, 'carol-tab-1')
                await _client_ready(ws_b, 'bob-tab-1')
                await _client_ready(ws_a, 'alice-tab-1')

                invite_c = await join(ws_c, 'carol-tab-1')
                self.assertEqual(len(invite_c['participants']), 3)
                invite_b = await join(ws_b, 'bob-tab-1')
                self.assertEqual(len(invite_b['participants']), 3)
                invite_a = await join(ws_a, 'alice-tab-1')
                self.assertEqual(len(invite_a['participants']), 3)

        import asyncio
        asyncio.run(body())

    @testutil.psinode_test
    def test_group_participant_joined_after_ws_reconnect(self, cluster):
        """Bob closes WS and rejoins; alice receives participantJoined for bob."""
        a = self._boot_with_chat_and_sig(cluster)
        _space_uuid, session_id = _create_group_chat_data_session(a)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        url = websocket_url(a, '/ws', service='x-webrtcsig')

        async def body():
            async with _unix_connect(
                a, url, [('Authorization', 'Bearer ' + ta)]
            ) as ws_a:
                await _welcome_and_presence(ws_a)
                await _client_ready(ws_a, 'alice-tab-1')
                await ws_a.send(
                    json.dumps(
                        {
                            't': 'joinSession',
                            'sessionId': session_id,
                            'clientInstanceId': 'alice-tab-1',
                        }
                    )
                )
                await _read_until(ws_a, 'sessionInvite')

                async with _unix_connect(
                    a, url, [('Authorization', 'Bearer ' + tb)]
                ) as ws_b1:
                    await _welcome_and_presence(ws_b1)
                    await _client_ready(ws_b1, 'bob-tab-1')
                    await ws_b1.send(
                        json.dumps(
                            {
                                't': 'joinSession',
                                'sessionId': session_id,
                                'clientInstanceId': 'bob-tab-1',
                            }
                        )
                    )
                    await _read_until(ws_b1, 'sessionInvite')
                    joined1 = await _read_until(ws_a, 'participantJoined')
                    self.assertEqual(joined1['participant'], 'bob')

                async with _unix_connect(
                    a, url, [('Authorization', 'Bearer ' + tb)]
                ) as ws_b2:
                    await _welcome_and_presence(ws_b2)
                    await _client_ready(ws_b2, 'bob-tab-2')
                    await ws_b2.send(
                        json.dumps(
                            {
                                't': 'joinSession',
                                'sessionId': session_id,
                                'clientInstanceId': 'bob-tab-2',
                            }
                        )
                    )
                    await _read_until(ws_b2, 'sessionInvite')
                    joined2 = await _read_until(ws_a, 'participantJoined')
                    self.assertEqual(joined2['participant'], 'bob')

        import asyncio
        asyncio.run(body())


if __name__ == '__main__':
    testutil.main()
