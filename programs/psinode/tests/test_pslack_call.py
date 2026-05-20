#!/usr/bin/env python
"""Integration tests for x-pslack v2 DM call signaling (architecture §11.1 Python cases)."""

import asyncio
import json
import os
import testutil
import unittest
import urllib3
import websockets

from predicates import new_block
from psinode import PrivateKey
from services import Transact


def _create_signed_account(a, name, key):
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


# Negotiate psibase.pslack.v2 first so CALL frames dispatch (v1 stubs return not-implemented).
PSLACK_SUBPROTOCOLS_V2_FIRST = ('psibase.pslack.v2', 'psibase.pslack.v1')


def _unix_connect_v2(node, url, headers):
    kwargs = {'subprotocols': list(PSLACK_SUBPROTOCOLS_V2_FIRST)}
    if headers:
        kwargs['additional_headers'] = headers
    return websockets.unix_connect(node.socketpath, url, **kwargs)


async def read_json(ws):
    raw = await ws.recv()
    if isinstance(raw, bytes):
        raw = raw.decode()
    return json.loads(raw)


async def welcome_v2(ws):
    welcome = await read_json(ws)
    assert welcome.get('t') == 'welcome'
    ice = await read_json(ws)
    assert ice.get('t') == 'iceServers'
    assert 'servers' in ice
    return welcome


class TestPslackCallSignaling(unittest.TestCase):
    def _boot_with_pslack(self, cluster):
        (a,) = cluster.complete(*testutil.generate_names(1))
        a.boot(packages=['Minimal', 'Explorer', 'TokenUsers', 'AuthSig'])
        a.install_local(['XWebRtcSig'])
        a.wait(new_block())
        return a

    @testutil.psinode_test
    def test_call_invite_accept_offer_answer_and_candidate_routing(self, cluster):
        a = self._boot_with_pslack(cluster)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        url = websocket_url(a, '/ws', service='x-pslack')

        async def body():
            async with _unix_connect_v2(a, url, [('Authorization', 'Bearer ' + ta)]) as ws_a, _unix_connect_v2(
                a, url, [('Authorization', 'Bearer ' + tb)]
            ) as ws_b:
                await welcome_v2(ws_a)
                await welcome_v2(ws_b)

                await ws_a.send(json.dumps({'t': 'openDm', 'member': 'bob'}))
                conv = await read_json(ws_a)
                assert conv['t'] == 'conversation'
                cid = conv['conversationId']
                await read_json(ws_b)

                await ws_a.send(
                    json.dumps(
                        {
                            't': 'callInvite',
                            'conversationId': cid,
                            'wantVideo': True,
                            'wantAudio': True,
                            'clientCallId': 'c1',
                        }
                    )
                )
                inv_a = await read_json(ws_a)
                inv_b = await read_json(ws_b)
                assert inv_a['t'] == 'callInvite'
                assert inv_b['t'] == 'callInvite'
                call_id = inv_a['callId']
                assert inv_b['callId'] == call_id

                await ws_b.send(json.dumps({'t': 'callAccept', 'callId': call_id}))
                acc_a = await read_json(ws_a)
                acc_b = await read_json(ws_b)
                assert acc_a['t'] == 'callAccept'
                assert acc_b['t'] == 'callAccept'

                ev_a = await read_json(ws_a)
                ev_b = await read_json(ws_b)
                assert ev_a['t'] == 'callEvent'
                assert ev_a['event'] == 'started'
                assert ev_b['t'] == 'callEvent'
                assert ev_b['event'] == 'started'

                await ws_a.send(
                    json.dumps({'t': 'callOffer', 'callId': call_id, 'sdp': 'offer-sdp-opaque'})
                )
                off_b = await read_json(ws_b)
                assert off_b['t'] == 'callOffer'
                assert off_b['from'] == 'alice'
                assert off_b['sdp'] == 'offer-sdp-opaque'

                await ws_b.send(json.dumps({'t': 'callAnswer', 'callId': call_id, 'sdp': 'answer-sdp'}))
                ans_a = await read_json(ws_a)
                assert ans_a['t'] == 'callAnswer'

                await ws_a.send(
                    json.dumps(
                        {
                            't': 'callCandidate',
                            'callId': call_id,
                            'candidate': 'cand-a',
                            'sdpMid': '0',
                            'sdpMLineIndex': 0,
                        }
                    )
                )
                cand_b = await read_json(ws_b)
                assert cand_b['t'] == 'callCandidate'
                assert cand_b['candidate'] == 'cand-a'

        asyncio.run(body())

    @testutil.psinode_test
    def test_call_invite_rejects_group_conversation(self, cluster):
        a = self._boot_with_pslack(cluster)
        ck = PrivateKey()
        _create_signed_account(a, 'charliezzz1', ck)

        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        tc = Transact(a).login('charliezzz1', keys=[ck])
        url = websocket_url(a, '/ws', service='x-pslack')

        async def body():
            async with _unix_connect_v2(a, url, [('Authorization', 'Bearer ' + ta)]) as ws_a:
                await welcome_v2(ws_a)
                async with _unix_connect_v2(a, url, [('Authorization', 'Bearer ' + tb)]) as ws_b, _unix_connect_v2(
                    a, url, [('Authorization', 'Bearer ' + tc)]
                ) as ws_c:
                    await welcome_v2(ws_b)
                    await welcome_v2(ws_c)

                    await ws_a.send(json.dumps({'t': 'openGroup', 'members': ['bob', 'charliezzz1']}))
                    grp = await read_json(ws_a)
                    assert grp['t'] == 'conversation'
                    assert grp['kind'] == 'group'
                    cid = grp['conversationId']

                    await ws_a.send(
                        json.dumps(
                            {
                                't': 'callInvite',
                                'conversationId': cid,
                                'wantVideo': True,
                                'wantAudio': True,
                                'clientCallId': 'gcall',
                            }
                        )
                    )
                    err = await read_json(ws_a)
                    assert err['t'] == 'callError'
                    assert err['code'] == 'not-dm'

        asyncio.run(body())

    @testutil.psinode_test
    def test_call_invite_rejects_non_member_as_not_member_error(self, cluster):
        a = self._boot_with_pslack(cluster)
        ck = PrivateKey()
        _create_signed_account(a, 'charliezzz2', ck)

        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        tc = Transact(a).login('charliezzz2', keys=[ck])
        url = websocket_url(a, '/ws', service='x-pslack')

        async def body():
            async with _unix_connect_v2(a, url, [('Authorization', 'Bearer ' + ta)]) as ws_a, _unix_connect_v2(
                a, url, [('Authorization', 'Bearer ' + tb)]
            ) as ws_b, _unix_connect_v2(a, url, [('Authorization', 'Bearer ' + tc)]) as ws_c:
                await welcome_v2(ws_a)
                await welcome_v2(ws_b)
                await welcome_v2(ws_c)

                await ws_a.send(json.dumps({'t': 'openDm', 'member': 'bob'}))
                conv = await read_json(ws_a)
                await read_json(ws_b)
                cid = conv['conversationId']

                await ws_c.send(
                    json.dumps(
                        {
                            't': 'callInvite',
                            'conversationId': cid,
                            'wantVideo': True,
                            'wantAudio': True,
                            'clientCallId': 'x',
                        }
                    )
                )
                err = await read_json(ws_c)
                assert err['t'] == 'callError'
                assert err['code'] == 'not-member'

        asyncio.run(body())

    @testutil.psinode_test
    def test_call_invite_busy_when_caller_already_in_call(self, cluster):
        a = self._boot_with_pslack(cluster)
        ck = PrivateKey()
        _create_signed_account(a, 'carolzzz1', ck)

        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        tc = Transact(a).login('carolzzz1', keys=[ck])
        url = websocket_url(a, '/ws', service='x-pslack')

        async def body():
            async with _unix_connect_v2(a, url, [('Authorization', 'Bearer ' + ta)]) as ws_a, _unix_connect_v2(
                a, url, [('Authorization', 'Bearer ' + tb)]
            ) as ws_b, _unix_connect_v2(a, url, [('Authorization', 'Bearer ' + tc)]) as ws_c:
                await welcome_v2(ws_a)
                await welcome_v2(ws_b)
                await welcome_v2(ws_c)

                await ws_a.send(json.dumps({'t': 'openDm', 'member': 'bob'}))
                conv_ab = await read_json(ws_a)
                await read_json(ws_b)
                ab = conv_ab['conversationId']

                await ws_a.send(json.dumps({'t': 'openDm', 'member': 'carolzzz1'}))
                conv_ac = await read_json(ws_a)
                await read_json(ws_c)
                ac = conv_ac['conversationId']

                await ws_a.send(
                    json.dumps(
                        {
                            't': 'callInvite',
                            'conversationId': ab,
                            'wantVideo': False,
                            'wantAudio': True,
                            'clientCallId': 'i1',
                        }
                    )
                )
                await read_json(ws_a)
                await read_json(ws_b)

                await ws_a.send(
                    json.dumps(
                        {
                            't': 'callInvite',
                            'conversationId': ac,
                            'wantVideo': False,
                            'wantAudio': True,
                            'clientCallId': 'i2',
                        }
                    )
                )
                err = await read_json(ws_a)
                assert err['t'] == 'callError'
                assert err['code'] == 'busy'

        asyncio.run(body())

    @testutil.psinode_test
    def test_call_peer_busy_when_callee_in_other_dm_call(self, cluster):
        a = self._boot_with_pslack(cluster)
        ck_carol = PrivateKey()
        _create_signed_account(a, 'carolzzz3', ck_carol)

        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        tc = Transact(a).login('carolzzz3', keys=[ck_carol])
        url = websocket_url(a, '/ws', service='x-pslack')

        async def body():
            async with _unix_connect_v2(a, url, [('Authorization', 'Bearer ' + ta)]) as ws_a, _unix_connect_v2(
                a, url, [('Authorization', 'Bearer ' + tb)]
            ) as ws_b, _unix_connect_v2(a, url, [('Authorization', 'Bearer ' + tc)]) as ws_c:
                await welcome_v2(ws_a)
                await welcome_v2(ws_b)
                await welcome_v2(ws_c)

                await ws_a.send(json.dumps({'t': 'openDm', 'member': 'bob'}))
                conv_ab = await read_json(ws_a)
                await read_json(ws_b)
                ab = conv_ab['conversationId']

                await ws_b.send(json.dumps({'t': 'openDm', 'member': 'carolzzz3'}))
                conv_bc = await read_json(ws_b)
                await read_json(ws_c)
                _bc = conv_bc['conversationId']

                await ws_b.send(
                    json.dumps(
                        {
                            't': 'callInvite',
                            'conversationId': _bc,
                            'wantVideo': False,
                            'wantAudio': True,
                            'clientCallId': 'bcb',
                        }
                    )
                )
                inv_b_self = await read_json(ws_b)
                inv_carol = await read_json(ws_c)
                assert inv_b_self['t'] == 'callInvite'
                assert inv_carol['t'] == 'callInvite'
                bc_call = inv_carol['callId']

                await ws_c.send(json.dumps({'t': 'callAccept', 'callId': bc_call}))
                acc_b = await read_json(ws_b)
                acc_c = await read_json(ws_c)
                assert acc_b['t'] == 'callAccept'
                assert acc_c['t'] == 'callAccept'

                ev_b = await read_json(ws_b)
                ev_c = await read_json(ws_c)
                assert ev_b['t'] == 'callEvent' and ev_b['event'] == 'started'
                assert ev_c['t'] == 'callEvent' and ev_c['event'] == 'started'

                await ws_a.send(
                    json.dumps(
                        {
                            't': 'callInvite',
                            'conversationId': ab,
                            'wantVideo': False,
                            'wantAudio': True,
                            'clientCallId': 'ab-inv',
                        }
                    )
                )
                err = await read_json(ws_a)
                assert err['t'] == 'callError'
                assert err['code'] == 'peer-busy'

        asyncio.run(body())

    @testutil.psinode_test
    def test_decline_stops_ringing_with_declined_timeline(self, cluster):
        a = self._boot_with_pslack(cluster)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        url = websocket_url(a, '/ws', service='x-pslack')

        async def body():
            async with _unix_connect_v2(a, url, [('Authorization', 'Bearer ' + ta)]) as ws_a, _unix_connect_v2(
                a, url, [('Authorization', 'Bearer ' + tb)]
            ) as ws_b:
                await welcome_v2(ws_a)
                await welcome_v2(ws_b)

                await ws_a.send(json.dumps({'t': 'openDm', 'member': 'bob'}))
                conv = await read_json(ws_a)
                await read_json(ws_b)
                cid = conv['conversationId']

                await ws_a.send(
                    json.dumps(
                        {
                            't': 'callInvite',
                            'conversationId': cid,
                            'wantVideo': False,
                            'wantAudio': True,
                            'clientCallId': 'decl1',
                        }
                    )
                )
                inv_a = await read_json(ws_a)
                inv_b = await read_json(ws_b)
                call_id = inv_a['callId']

                await ws_b.send(json.dumps({'t': 'callDecline', 'callId': call_id, 'reason': 'declined'}))

                ev_b = await read_json(ws_b)
                assert ev_b['t'] == 'callEvent'
                assert ev_b['event'] == 'declined'
                assert ev_b.get('actor') == 'bob'

                ev_a = await read_json(ws_a)
                decl_a = await read_json(ws_a)
                assert ev_a['t'] == 'callEvent'
                assert ev_a['event'] == 'declined'
                assert decl_a['t'] == 'callDecline'
                assert decl_a['by'] == 'bob'

        asyncio.run(body())

    @testutil.psinode_test
    def test_call_collision_lex_tiebreak_second_invitee_loses(self, cluster):
        a = self._boot_with_pslack(cluster)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        url = websocket_url(a, '/ws', service='x-pslack')

        async def body():
            async with _unix_connect_v2(a, url, [('Authorization', 'Bearer ' + ta)]) as ws_a, _unix_connect_v2(
                a, url, [('Authorization', 'Bearer ' + tb)]
            ) as ws_b:
                await welcome_v2(ws_a)
                await welcome_v2(ws_b)

                await ws_a.send(json.dumps({'t': 'openDm', 'member': 'bob'}))
                conv = await read_json(ws_a)
                await read_json(ws_b)
                cid = conv['conversationId']

                await ws_a.send(
                    json.dumps(
                        {
                            't': 'callInvite',
                            'conversationId': cid,
                            'wantVideo': False,
                            'wantAudio': True,
                            'clientCallId': 'a1',
                        }
                    )
                )
                await read_json(ws_a)
                await read_json(ws_b)

                await ws_b.send(
                    json.dumps(
                        {
                            't': 'callInvite',
                            'conversationId': cid,
                            'wantVideo': False,
                            'wantAudio': True,
                            'clientCallId': 'b1',
                        }
                    )
                )
                err_b = await read_json(ws_b)
                assert err_b['t'] == 'callError'
                assert err_b['code'] == 'collision-lost'

        asyncio.run(body())

    @testutil.psinode_test
    def test_call_hangup_tears_down_state_for_next_invite(self, cluster):
        a = self._boot_with_pslack(cluster)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        url = websocket_url(a, '/ws', service='x-pslack')

        async def body():
            async with _unix_connect_v2(a, url, [('Authorization', 'Bearer ' + ta)]) as ws_a, _unix_connect_v2(
                a, url, [('Authorization', 'Bearer ' + tb)]
            ) as ws_b:
                await welcome_v2(ws_a)
                await welcome_v2(ws_b)

                await ws_a.send(json.dumps({'t': 'openDm', 'member': 'bob'}))
                conv = await read_json(ws_a)
                await read_json(ws_b)
                cid = conv['conversationId']

                async def one_call(client_call_id: str):
                    await ws_a.send(
                        json.dumps(
                            {
                                't': 'callInvite',
                                'conversationId': cid,
                                'wantVideo': False,
                                'wantAudio': True,
                                'clientCallId': client_call_id,
                            }
                        )
                    )
                    inv_a = await read_json(ws_a)
                    inv_b = await read_json(ws_b)
                    call_id = inv_a['callId']
                    assert inv_b['callId'] == call_id

                    await ws_b.send(json.dumps({'t': 'callAccept', 'callId': call_id}))
                    pairs_a = [await read_json(ws_a), await read_json(ws_a)]
                    pairs_b = [await read_json(ws_b), await read_json(ws_b)]
                    assert {pairs_a[0]['t'], pairs_a[1]['t']} == {'callAccept', 'callEvent'}
                    assert {pairs_b[0]['t'], pairs_b[1]['t']} == {'callAccept', 'callEvent'}

                    await ws_a.send(json.dumps({'t': 'callHangup', 'callId': call_id, 'reason': 'user'}))

                    tear_a = [await read_json(ws_a), await read_json(ws_a)]
                    tear_b = [await read_json(ws_b), await read_json(ws_b)]
                    for pair in (tear_a, tear_b):
                        titles = [p['t'] for p in pair]
                        assert 'callHangup' in titles
                        assert any(p['t'] == 'callEvent' and p['event'] == 'ended' for p in pair)

                await one_call('round1')

                await one_call('round2')

        asyncio.run(body())

    @testutil.psinode_test
    def test_call_socket_close_while_ringing_calls_failed_transport_peer(self, cluster):
        a = self._boot_with_pslack(cluster)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        url = websocket_url(a, '/ws', service='x-pslack')

        async def body():
            async with _unix_connect_v2(a, url, [('Authorization', 'Bearer ' + ta)]) as ws_a, _unix_connect_v2(
                a, url, [('Authorization', 'Bearer ' + tb)]
            ) as ws_b:
                await welcome_v2(ws_a)
                await welcome_v2(ws_b)

                await ws_a.send(json.dumps({'t': 'openDm', 'member': 'bob'}))
                conv = await read_json(ws_a)
                await read_json(ws_b)
                cid = conv['conversationId']

                await ws_a.send(
                    json.dumps(
                        {
                            't': 'callInvite',
                            'conversationId': cid,
                            'wantVideo': False,
                            'wantAudio': True,
                            'clientCallId': 'sc1',
                        }
                    )
                )
                await read_json(ws_a)
                await read_json(ws_b)

                await ws_a.close()

                await asyncio.sleep(0.05)

                err_b = await read_json(ws_b)
                assert err_b['t'] == 'callError'
                assert err_b['code'] == 'websocket-closed'

                ev_b = await read_json(ws_b)
                assert ev_b['t'] == 'callEvent'
                assert ev_b['event'] == 'failed'
                assert ev_b.get('reason') == 'transport'

        asyncio.run(body())

    @testutil.psinode_test
    def test_unanswered_hangup_with_timeout_reason_emits_missed_peer(self, cluster):
        a = self._boot_with_pslack(cluster)
        ta = Transact(a).login('alice')
        tb = Transact(a).login('bob')
        url = websocket_url(a, '/ws', service='x-pslack')

        async def body():
            async with _unix_connect_v2(a, url, [('Authorization', 'Bearer ' + ta)]) as ws_a, _unix_connect_v2(
                a, url, [('Authorization', 'Bearer ' + tb)]
            ) as ws_b:
                await welcome_v2(ws_a)
                await welcome_v2(ws_b)

                await ws_a.send(json.dumps({'t': 'openDm', 'member': 'bob'}))
                conv = await read_json(ws_a)
                await read_json(ws_b)
                cid = conv['conversationId']

                await ws_a.send(
                    json.dumps(
                        {
                            't': 'callInvite',
                            'conversationId': cid,
                            'wantVideo': False,
                            'wantAudio': True,
                            'clientCallId': 'ms1',
                        }
                    )
                )
                inv_a = await read_json(ws_a)
                inv_b = await read_json(ws_b)
                call_id = inv_a['callId']

                await ws_a.send(json.dumps({'t': 'callHangup', 'callId': call_id, 'reason': 'timeout'}))

                async def drain_ws(ws, limit):
                    out = []
                    for _ in range(limit):
                        out.append(await read_json(ws))
                    return out

                recv_b, recv_a = await asyncio.gather(
                    drain_ws(ws_b, 6),
                    drain_ws(ws_a, 6),
                )

                assert any(
                    isinstance(fr, dict) and fr.get('t') == 'callTimeout' and fr.get('callId') == call_id
                    for fr in recv_b
                )

                missed = [
                    fr
                    for fr in recv_a + recv_b
                    if isinstance(fr, dict) and fr.get('t') == 'callEvent' and fr.get('event') == 'missed'
                ]
                assert missed
                assert missed[0].get('reason') == 'timeout'

        asyncio.run(body())


if __name__ == '__main__':
    testutil.main()
