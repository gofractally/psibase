"""Headless DM/group chat-data WebRTC negotiation via aiortc + x-webrtcsig (no browser)."""

from __future__ import annotations

import asyncio
import json
import random
import time
from typing import Any, Callable

try:
    from aiortc import (
        RTCIceCandidate,
        RTCPeerConnection,
        RTCSessionDescription,
    )
    from aiortc.rtcconfiguration import RTCConfiguration, RTCIceServer
except ImportError:  # pragma: no cover
    RTCPeerConnection = None  # type: ignore
    RTCConfiguration = None  # type: ignore

CHAT_LABEL = 'chat'


def _rtc_config_host_only():
    """Match browser buildRtcPeerConnectionConfig when welcome has no TURN."""
    return RTCConfiguration(iceServers=[])


def _rtc_config_stun_only():
    """Legacy harness config; srflx can fail on same-machine hairpin NAT."""
    return RTCConfiguration(
        iceServers=[
            RTCIceServer(urls=['stun:stun.l.google.com:19302']),
            RTCIceServer(urls=['stun:stun.cloudflare.com:3478']),
        ]
    )


def _rtc_config(use_host_only: bool = True):
    return _rtc_config_host_only() if use_host_only else _rtc_config_stun_only()


def aiortc_available() -> bool:
    return RTCPeerConnection is not None


def _should_initiate_offer(self_account: str, peer_account: str) -> bool:
    return self_account < peer_account


class _WsRouter:
    """Single reader per websocket; routes frames to waiters or signal queue."""

    def __init__(self, ws, account: str):
        self.ws = ws
        self.account = account
        self._queue: asyncio.Queue = asyncio.Queue()
        self._signals: asyncio.Queue = asyncio.Queue()
        self._waiters = []
        self._task = asyncio.create_task(self._read_loop())

    async def _read_loop(self):
        try:
            async for raw in self.ws:
                msg = json.loads(raw if isinstance(raw, str) else raw.decode())
                if msg.get('t') == 'signal' and msg.get('to') == self.account:
                    await self._signals.put(msg)
                    continue
                remaining = []
                for pred, fut in self._waiters:
                    if fut.done():
                        continue
                    if pred(msg):
                        fut.set_result(msg)
                    else:
                        remaining.append((pred, fut))
                self._waiters[:] = remaining
                if not any(pred(msg) for pred, fut in self._waiters if not fut.done()):
                    await self._queue.put(msg)
        finally:
            for _, fut in self._waiters:
                if not fut.done():
                    fut.cancel()

    async def wait_for(self, pred: Callable[[dict], bool], label: str, timeout: float = 15.0):
        while not self._queue.empty():
            msg = self._queue.get_nowait()
            if pred(msg):
                return msg
        loop = asyncio.get_event_loop()
        fut = loop.create_future()
        self._waiters.append((pred, fut))
        try:
            while True:
                msg = await asyncio.wait_for(fut, timeout=timeout)
                if pred(msg):
                    return msg
                await self._queue.put(msg)
                fut = loop.create_future()
                self._waiters.append((pred, fut))
        except asyncio.TimeoutError as e:
            raise RuntimeError(f'{label}: timeout') from e

    async def next_signal(self):
        return await self._signals.get()

    def stop(self):
        self._task.cancel()


class _ChatPeer:
    def __init__(
        self,
        *,
        self_account: str,
        peer_account: str,
        is_initiator: bool,
        send_signal: Callable[[dict], None],
        use_host_only_ice: bool = True,
    ):
        self.self_account = self_account
        self.peer_account = peer_account
        self.is_initiator = is_initiator
        self.send_signal = send_signal
        self.pc = RTCPeerConnection(configuration=_rtc_config(use_host_only_ice))
        self.pending_remote_ice: list[dict] = []
        self.data_channel_open = asyncio.Event()
        self._lock = asyncio.Lock()

    async def flush_buffered(self):
        buf = self.pending_remote_ice[:]
        self.pending_remote_ice.clear()
        for init in buf:
            try:
                await self.pc.addIceCandidate(
                    RTCIceCandidate(
                        candidate=init.get('candidate'),
                        sdpMid=init.get('sdpMid'),
                        sdpMLineIndex=init.get('sdpMLineIndex'),
                    )
                )
            except Exception:
                pass

    async def apply_signal(self, frame: dict):
        async with self._lock:
            kind = frame.get('kind')
            if kind == 'offer' and frame.get('sdp'):
                await self.pc.setRemoteDescription(
                    RTCSessionDescription(sdp=frame['sdp'], type='offer')
                )
                await self.flush_buffered()
                answer = await self.pc.createAnswer()
                await self.pc.setLocalDescription(answer)
                await self.flush_buffered()
                self.send_signal(
                    {'kind': 'answer', 'sdp': self.pc.localDescription.sdp}
                )
                return
            if kind == 'answer' and frame.get('sdp'):
                await self.pc.setRemoteDescription(
                    RTCSessionDescription(sdp=frame['sdp'], type='answer')
                )
                await self.flush_buffered()
                return
            if kind == 'candidate':
                init = {
                    'candidate': frame.get('candidate') or '',
                    'sdpMid': frame.get('sdpMid'),
                    'sdpMLineIndex': frame.get('sdpMLineIndex'),
                }
                if self.pc.remoteDescription is None:
                    self.pending_remote_ice.append(init)
                    return
                try:
                    await self.pc.addIceCandidate(
                        RTCIceCandidate(
                            candidate=init['candidate'],
                            sdpMid=init['sdpMid'],
                            sdpMLineIndex=init['sdpMLineIndex'],
                        )
                    )
                except Exception:
                    pass

    def setup_ice(self):
        @self.pc.on('icecandidate')
        async def on_ice(candidate):
            if candidate is None:
                return
            self.send_signal(
                {
                    'kind': 'candidate',
                    'candidate': candidate.candidate,
                    'sdpMid': candidate.sdpMid,
                    'sdpMLineIndex': candidate.sdpMLineIndex,
                }
            )

    async def setup_data_channel(self, *, space_uuid: str = 'space:test'):
        self.data_channel = None
        self.received_messages: list[str] = []
        self.received_bodies: list[str] = []
        self.received_client_msg_ids: set[str] = set()
        self.space_uuid = space_uuid

        def attach(channel):
            if channel.label != CHAT_LABEL:
                return
            self.data_channel = channel

            def on_message(msg):
                if isinstance(msg, bytes):
                    msg = msg.decode()
                self.received_messages.append(msg)
                try:
                    envelope = json.loads(msg)
                except json.JSONDecodeError:
                    return
                if envelope.get('t') == 'chatMessage':
                    body = envelope.get('body', '')
                    client_msg_id = envelope.get('clientMsgId', '')
                    if body:
                        self.received_bodies.append(body)
                    if client_msg_id:
                        self.received_client_msg_ids.add(client_msg_id)
                    ack = {
                        't': 'messageAck',
                        'spaceUuid': envelope.get('spaceUuid', self.space_uuid),
                        'clientMsgId': client_msg_id,
                        'from': self.self_account,
                    }
                    if channel.readyState == 'open':
                        channel.send(json.dumps(ack))

            channel.on("message")(on_message)

            def on_open():
                self.data_channel_open.set()

            if channel.readyState == "open":
                on_open()
            else:
                channel.on("open")(on_open)

        if self.is_initiator:
            channel = self.pc.createDataChannel(CHAT_LABEL, ordered=True)
            attach(channel)
        else:

            @self.pc.on("datachannel")
            def on_dc(channel):
                attach(channel)

    def send_chat(self, payload: str) -> bool:
        ch = getattr(self, "data_channel", None)
        if ch is None or ch.readyState != "open":
            return False
        ch.send(payload)
        return True

    def send_chat_message_envelope(
        self,
        *,
        body: str,
        client_msg_id: str,
        send_timestamp: float | None = None,
    ) -> bool:
        envelope = {
            't': 'chatMessage',
            'spaceUuid': self.space_uuid,
            'from': self.self_account,
            'body': body,
            'sendTimestamp': send_timestamp if send_timestamp is not None else time.time() * 1000,
            'clientMsgId': client_msg_id,
        }
        return self.send_chat(json.dumps(envelope))

    async def send_offer(self):
        offer = await self.pc.createOffer()
        await self.pc.setLocalDescription(offer)
        self.send_signal({'kind': 'offer', 'sdp': self.pc.localDescription.sdp})

    async def close(self):
        await self.pc.close()


async def run_chat_data_p2p(
    *,
    unix_connect,
    url: str,
    session_id: str,
    alice: str,
    bob: str,
    token_alice: str,
    token_bob: str,
    timeout_s: float = 45.0,
    use_host_only_ice: bool = True,
) -> dict[str, Any]:
    if not aiortc_available():
        raise RuntimeError('aiortc not installed (pip install aiortc)')

    outbound: list[tuple[str, dict]] = []
    peers: dict[str, _ChatPeer] = {}

    def send_for(account: str, payload: dict):
        outbound.append((account, payload))

    peers[alice] = _ChatPeer(
        self_account=alice,
        peer_account=bob,
        is_initiator=_should_initiate_offer(alice, bob),
        send_signal=lambda p: send_for(alice, p),
        use_host_only_ice=use_host_only_ice,
    )
    peers[bob] = _ChatPeer(
        self_account=bob,
        peer_account=alice,
        is_initiator=_should_initiate_offer(bob, alice),
        send_signal=lambda p: send_for(bob, p),
        use_host_only_ice=use_host_only_ice,
    )
    for peer in peers.values():
        peer.setup_ice()
        await peer.setup_data_channel()

    headers_a = [('Authorization', f'Bearer {token_alice}')]
    headers_b = [('Authorization', f'Bearer {token_bob}')]

    async with unix_connect(url, headers_a) as ws_a, unix_connect(
        url, headers_b
    ) as ws_b:
        router_a = _WsRouter(ws_a, alice)
        router_b = _WsRouter(ws_b, bob)

        async def flush_outbound():
            while outbound:
                who, payload = outbound.pop(0)
                ws = ws_a if who == alice else ws_b
                dest = bob if who == alice else alice
                await ws.send(
                    json.dumps(
                        {
                            't': 'signal',
                            'sessionId': session_id,
                            'to': dest,
                            **payload,
                        }
                    )
                )

        async def pump_outbound():
            try:
                while True:
                    await flush_outbound()
                    await asyncio.sleep(0.05)
            except asyncio.CancelledError:
                await flush_outbound()
                raise

        pump_task = asyncio.create_task(pump_outbound())

        await router_a.wait_for(lambda m: m['t'] == 'welcome', 'alice-welcome')
        await router_b.wait_for(lambda m: m['t'] == 'welcome', 'bob-welcome')
        await router_a.wait_for(
            lambda m: m['t'] == 'presenceSnapshot', 'alice-presence'
        )
        await router_b.wait_for(lambda m: m['t'] == 'presenceSnapshot', 'bob-presence')

        await ws_a.send(
            json.dumps(
                {
                    't': 'clientReady',
                    'clientInstanceId': 'p2p-alice',
                    'active': True,
                    'visible': True,
                    'supports': {'audio': True, 'video': True, 'data': True},
                }
            )
        )
        await ws_b.send(
            json.dumps(
                {
                    't': 'clientReady',
                    'clientInstanceId': 'p2p-bob',
                    'active': True,
                    'visible': True,
                    'supports': {'audio': True, 'video': True, 'data': True},
                }
            )
        )

        try:
            await router_a.wait_for(
                lambda m: m['t'] == 'presence' and m.get('account') == bob,
                'bob-online',
                timeout=3.0,
            )
        except RuntimeError:
            pass

        async def signal_loop(router: _WsRouter, account: str):
            try:
                while True:
                    msg = await router.next_signal()
                    src = msg.get('from') or (bob if account == alice else alice)
                    msg['from'] = src
                    await peers[account].apply_signal(msg)
            except asyncio.CancelledError:
                raise

        sig_a = asyncio.create_task(signal_loop(router_a, alice))
        sig_b = asyncio.create_task(signal_loop(router_b, bob))

        await ws_a.send(
            json.dumps(
                {
                    't': 'joinSession',
                    'sessionId': session_id,
                    'clientInstanceId': 'p2p-alice',
                }
            )
        )
        await router_a.wait_for(lambda m: m['t'] == 'sessionInvite', 'alice-invite')

        await ws_b.send(
            json.dumps(
                {
                    't': 'joinSession',
                    'sessionId': session_id,
                    'clientInstanceId': 'p2p-bob',
                }
            )
        )
        await router_b.wait_for(lambda m: m['t'] == 'sessionInvite', 'bob-invite')
        await router_a.wait_for(
            lambda m: m['t'] == 'participantJoined', 'alice-joined'
        )
        await router_a.wait_for(
            lambda m: m['t'] == 'sessionInvite' and m.get('from') == bob,
            'relay-invite',
        )

        if peers[alice].is_initiator:
            await peers[alice].send_offer()

        deadline = asyncio.get_event_loop().time() + timeout_s
        ok = False
        while asyncio.get_event_loop().time() < deadline:
            if (
                peers[alice].data_channel_open.is_set()
                and peers[bob].data_channel_open.is_set()
            ):
                ok = True
                break
            if (
                peers[alice].pc.connectionState == 'failed'
                or peers[bob].pc.connectionState == 'failed'
            ):
                break
            await asyncio.sleep(0.2)

        pump_task.cancel()
        sig_a.cancel()
        sig_b.cancel()
        router_a.stop()
        router_b.stop()
        await peers[alice].close()
        await peers[bob].close()

        return {
            'ok': ok,
            'sessionId': session_id,
            'useHostOnlyIce': use_host_only_ice,
            'alice': {
                'dataChannelOpen': peers[alice].data_channel_open.is_set(),
                'connectionState': peers[alice].pc.connectionState,
                'iceConnectionState': peers[alice].pc.iceConnectionState,
                'received': list(peers[alice].received_messages),
            },
            'bob': {
                'dataChannelOpen': peers[bob].data_channel_open.is_set(),
                'connectionState': peers[bob].pc.connectionState,
                'iceConnectionState': peers[bob].pc.iceConnectionState,
                'received': list(peers[bob].received_messages),
            },
        }


# ---------------------------------------------------------------------------
# Rejoin / pending-flush helpers (regression for "queued DM not flushed when
# the other client closes and reopens the chat app"). The harness simulates
# the production client orchestrator: when participantJoined arrives for an
# already-active peer, we discard the existing aiortc peer and renegotiate.
# ---------------------------------------------------------------------------


async def _negotiate_dm_pair(
    *,
    alice: str,
    bob: str,
    session_id: str,
    ws_a,
    ws_b,
    router_a: '_WsRouter',
    router_b: '_WsRouter',
    alice_instance: str,
    bob_instance: str,
    timeout_s: float,
    use_host_only_ice: bool,
) -> tuple['_ChatPeer', '_ChatPeer', list[asyncio.Task]]:
    """Drive a fresh negotiation cycle for an existing alice/bob session."""
    outbound: list[tuple[str, dict]] = []

    def send_for(account: str, payload: dict):
        outbound.append((account, payload))

    peers = {
        alice: _ChatPeer(
            self_account=alice,
            peer_account=bob,
            is_initiator=_should_initiate_offer(alice, bob),
            send_signal=lambda p: send_for(alice, p),
            use_host_only_ice=use_host_only_ice,
        ),
        bob: _ChatPeer(
            self_account=bob,
            peer_account=alice,
            is_initiator=_should_initiate_offer(bob, alice),
            send_signal=lambda p: send_for(bob, p),
            use_host_only_ice=use_host_only_ice,
        ),
    }

    for peer in peers.values():
        peer.setup_ice()
        await peer.setup_data_channel()

    async def flush_outbound():
        while outbound:
            who, payload = outbound.pop(0)
            ws = ws_a if who == alice else ws_b
            dest = bob if who == alice else alice
            await ws.send(
                json.dumps(
                    {
                        't': 'signal',
                        'sessionId': session_id,
                        'to': dest,
                        **payload,
                    }
                )
            )

    async def pump_outbound():
        try:
            while True:
                await flush_outbound()
                await asyncio.sleep(0.05)
        except asyncio.CancelledError:
            await flush_outbound()
            raise

    async def signal_loop(router: _WsRouter, account: str):
        try:
            while True:
                msg = await router.next_signal()
                src = msg.get('from') or (bob if account == alice else alice)
                msg['from'] = src
                await peers[account].apply_signal(msg)
        except asyncio.CancelledError:
            raise

    pump_task = asyncio.create_task(pump_outbound())
    sig_a = asyncio.create_task(signal_loop(router_a, alice))
    sig_b = asyncio.create_task(signal_loop(router_b, bob))

    if peers[alice].is_initiator:
        await peers[alice].send_offer()

    deadline = asyncio.get_event_loop().time() + timeout_s
    while asyncio.get_event_loop().time() < deadline:
        if (
            peers[alice].data_channel_open.is_set()
            and peers[bob].data_channel_open.is_set()
        ):
            break
        if (
            peers[alice].pc.connectionState == 'failed'
            or peers[bob].pc.connectionState == 'failed'
        ):
            break
        await asyncio.sleep(0.2)

    return peers[alice], peers[bob], [pump_task, sig_a, sig_b]


async def run_chat_data_p2p_pending_flush_on_rejoin(
    *,
    unix_connect,
    url: str,
    session_id: str,
    alice: str,
    bob: str,
    token_alice: str,
    token_bob: str,
    timeout_s: float = 45.0,
    use_host_only_ice: bool = True,
) -> dict[str, Any]:
    """End-to-end DM rejoin: bob closes ws, reopens, queued DM arrives on new DC."""
    if not aiortc_available():
        raise RuntimeError('aiortc not installed (pip install aiortc)')

    headers_a = [('Authorization', f'Bearer {token_alice}')]
    headers_b = [('Authorization', f'Bearer {token_bob}')]

    async def open_session(ws, account, instance):
        await ws.send(
            json.dumps(
                {
                    't': 'clientReady',
                    'clientInstanceId': instance,
                    'active': True,
                    'visible': True,
                    'supports': {'audio': True, 'video': True, 'data': True},
                }
            )
        )
        await ws.send(
            json.dumps(
                {
                    't': 'joinSession',
                    'sessionId': session_id,
                    'clientInstanceId': instance,
                }
            )
        )

    initial_first_msg = 'hello-from-alice-1'
    pending_msg = 'queued-while-bob-was-away'

    async with unix_connect(url, headers_a) as ws_a:
        router_a = _WsRouter(ws_a, alice)
        await router_a.wait_for(lambda m: m['t'] == 'welcome', 'alice-welcome')
        await router_a.wait_for(
            lambda m: m['t'] == 'presenceSnapshot', 'alice-presence'
        )

        async with unix_connect(url, headers_b) as ws_b1:
            router_b1 = _WsRouter(ws_b1, bob)
            await router_b1.wait_for(lambda m: m['t'] == 'welcome', 'bob-welcome-1')
            await router_b1.wait_for(
                lambda m: m['t'] == 'presenceSnapshot', 'bob-presence-1'
            )

            await open_session(ws_a, alice, 'rejoin-alice')
            await open_session(ws_b1, bob, 'rejoin-bob-1')

            await router_a.wait_for(
                lambda m: m['t'] == 'sessionInvite', 'alice-invite-1'
            )
            await router_b1.wait_for(
                lambda m: m['t'] == 'sessionInvite', 'bob-invite-1'
            )
            await router_a.wait_for(
                lambda m: m['t'] == 'participantJoined', 'alice-sees-bob-join-1'
            )

            alice_peer, bob_peer1, tasks1 = await _negotiate_dm_pair(
                alice=alice,
                bob=bob,
                session_id=session_id,
                ws_a=ws_a,
                ws_b=ws_b1,
                router_a=router_a,
                router_b=router_b1,
                alice_instance='rejoin-alice',
                bob_instance='rejoin-bob-1',
                timeout_s=timeout_s,
                use_host_only_ice=use_host_only_ice,
            )

            initial_ok = (
                alice_peer.data_channel_open.is_set()
                and bob_peer1.data_channel_open.is_set()
            )
            if initial_ok:
                alice_peer.send_chat(initial_first_msg)
                deadline = asyncio.get_event_loop().time() + 5.0
                while (
                    asyncio.get_event_loop().time() < deadline
                    and initial_first_msg not in bob_peer1.received_messages
                ):
                    await asyncio.sleep(0.05)

            for t in tasks1:
                t.cancel()
            await bob_peer1.close()
            router_b1.stop()

        # Bob is gone; alice queues a pending message locally (mirrors the
        # browser pending-flush queue while the peer's tab is closed).
        pending_received = False
        rejoin_alice_peer = None
        rejoin_bob_peer = None

        async with unix_connect(url, headers_b) as ws_b2:
            router_b2 = _WsRouter(ws_b2, bob)
            await router_b2.wait_for(lambda m: m['t'] == 'welcome', 'bob-welcome-2')
            await router_b2.wait_for(
                lambda m: m['t'] == 'presenceSnapshot', 'bob-presence-2'
            )

            await open_session(ws_b2, bob, 'rejoin-bob-2')
            await router_b2.wait_for(
                lambda m: m['t'] == 'sessionInvite', 'bob-invite-2'
            )

            # Production orchestrator: when participantJoined fires for an
            # active session it tears down the old peer and renegotiates.
            await router_a.wait_for(
                lambda m: m['t'] == 'participantJoined'
                and m.get('participant') == bob
                and m.get('sessionId') == session_id,
                'alice-sees-bob-join-2',
                timeout=15.0,
            )
            await alice_peer.close()

            rejoin_alice_peer, rejoin_bob_peer, tasks2 = await _negotiate_dm_pair(
                alice=alice,
                bob=bob,
                session_id=session_id,
                ws_a=ws_a,
                ws_b=ws_b2,
                router_a=router_a,
                router_b=router_b2,
                alice_instance='rejoin-alice',
                bob_instance='rejoin-bob-2',
                timeout_s=timeout_s,
                use_host_only_ice=use_host_only_ice,
            )

            renegotiation_ok = (
                rejoin_alice_peer.data_channel_open.is_set()
                and rejoin_bob_peer.data_channel_open.is_set()
            )

            if renegotiation_ok:
                rejoin_alice_peer.send_chat(pending_msg)
                deadline = asyncio.get_event_loop().time() + 8.0
                while asyncio.get_event_loop().time() < deadline:
                    if pending_msg in rejoin_bob_peer.received_messages:
                        pending_received = True
                        break
                    await asyncio.sleep(0.05)

            for t in tasks2:
                t.cancel()
            await rejoin_alice_peer.close()
            await rejoin_bob_peer.close()
            router_b2.stop()

        router_a.stop()

    return {
        'sessionId': session_id,
        'initialDataChannelOk': initial_ok,
        'initialMessageDelivered': (
            initial_ok and initial_first_msg in bob_peer1.received_messages
        ),
        'renegotiationOk': bool(
            rejoin_alice_peer
            and rejoin_bob_peer
            and rejoin_alice_peer.data_channel_open.is_set()
            and rejoin_bob_peer.data_channel_open.is_set()
        ),
        'pendingDelivered': pending_received,
    }


# ---------------------------------------------------------------------------
# N-party group mesh helpers (3+ peers, real chatMessage / messageAck)
# ---------------------------------------------------------------------------


def _pair_key(a: str, b: str) -> tuple[str, str]:
    return (a, b) if a < b else (b, a)


class _GroupPendingStore:
    """Minimal in-memory pending queue mirroring the browser pending store."""

    def __init__(self, space_uuid: str, members: list[str]):
        self.space_uuid = space_uuid
        self.members = members
        self.rows: list[dict[str, Any]] = []

    def enqueue(
        self,
        *,
        sender: str,
        body: str,
        client_msg_id: str,
        created_at: float | None = None,
    ) -> None:
        recipients = [m for m in self.members if m != sender]
        self.rows.append(
            {
                'clientMsgId': client_msg_id,
                'from': sender,
                'body': body,
                'createdAt': created_at if created_at is not None else time.time() * 1000,
                'recipients': recipients,
                'deliveredTo': [],
                'status': 'pending',
            }
        )

    def mark_delivered(self, client_msg_id: str, recipient: str) -> None:
        for row in self.rows:
            if row['clientMsgId'] != client_msg_id:
                continue
            if recipient not in row['deliveredTo']:
                row['deliveredTo'].append(recipient)
            pending = [
                r for r in row['recipients'] if r not in row['deliveredTo']
            ]
            if not pending:
                row['status'] = 'sent'

    def pending_for_recipient(self, recipient: str) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for row in self.rows:
            if row['status'] != 'pending':
                continue
            if recipient in row['deliveredTo']:
                continue
            if recipient in row['recipients']:
                out.append(row)
        return out


class _GroupMeshSession:
    """Drive a 3-party full mesh over x-webrtcsig with aiortc data channels."""

    def __init__(
        self,
        *,
        accounts: list[str],
        session_id: str,
        space_uuid: str,
        use_host_only_ice: bool,
    ):
        if len(accounts) != 3:
            raise ValueError('group mesh harness supports exactly 3 accounts')
        self.accounts = accounts
        self.session_id = session_id
        self.space_uuid = space_uuid
        self.use_host_only_ice = use_host_only_ice
        self.outbound: list[tuple[str, str, dict]] = []
        # (self_account, remote_account) -> _ChatPeer
        self.peers: dict[tuple[str, str], _ChatPeer] = {}
        self.pending_by_sender: dict[str, _GroupPendingStore] = {
            acct: _GroupPendingStore(space_uuid, accounts) for acct in accounts
        }
        self.routers: dict[str, _WsRouter] = {}
        self.ws: dict[str, Any] = {}
        self._pump_task: asyncio.Task | None = None
        self._signal_tasks: list[asyncio.Task] = []

    def _peer(self, self_account: str, remote_account: str) -> _ChatPeer:
        return self.peers[(self_account, remote_account)]

    def _ensure_peer(self, self_account: str, remote_account: str) -> _ChatPeer:
        key = (self_account, remote_account)
        if key in self.peers:
            return self.peers[key]

        def send_signal(payload: dict):
            self.outbound.append((self_account, remote_account, payload))

        peer = _ChatPeer(
            self_account=self_account,
            peer_account=remote_account,
            is_initiator=_should_initiate_offer(self_account, remote_account),
            send_signal=send_signal,
            use_host_only_ice=self.use_host_only_ice,
        )
        peer.setup_ice()
        self.peers[key] = peer
        return peer

    async def _flush_outbound(self):
        while self.outbound:
            sender, dest, payload = self.outbound.pop(0)
            ws = self.ws.get(sender)
            if ws is None:
                continue
            await ws.send(
                json.dumps(
                    {
                        't': 'signal',
                        'sessionId': self.session_id,
                        'to': dest,
                        **payload,
                    }
                )
            )

    async def _pump_outbound(self):
        try:
            while True:
                await self._flush_outbound()
                await asyncio.sleep(0.05)
        except asyncio.CancelledError:
            await self._flush_outbound()
            raise

    async def _signal_loop(self, account: str):
        router = self.routers[account]
        try:
            while True:
                msg = await router.next_signal()
                src = msg.get('from')
                if not src:
                    continue
                await self._peer(account, src).apply_signal(msg)
        except asyncio.CancelledError:
            raise

    async def _setup_all_peers(self):
        for self_acct in self.accounts:
            for remote in self.accounts:
                if remote == self_acct:
                    continue
                peer = self._ensure_peer(self_acct, remote)
                await peer.setup_data_channel(space_uuid=self.space_uuid)

    async def _send_offer_if_initiator(self, a: str, b: str):
        peer = self._peer(a, b)
        if peer.is_initiator:
            await peer.send_offer()

    async def _negotiate_pair(self, a: str, b: str, timeout_s: float) -> bool:
        await self._send_offer_if_initiator(a, b)
        await self._send_offer_if_initiator(b, a)
        deadline = asyncio.get_event_loop().time() + timeout_s
        while asyncio.get_event_loop().time() < deadline:
            pa = self._peer(a, b)
            pb = self._peer(b, a)
            if pa.data_channel_open.is_set() and pb.data_channel_open.is_set():
                await self._on_dc_open(a, b)
                await self._on_dc_open(b, a)
                return True
            if (
                pa.pc.connectionState == 'failed'
                or pb.pc.connectionState == 'failed'
            ):
                return False
            await asyncio.sleep(0.1)
        return False

    async def _negotiate_full_mesh(self, timeout_s: float) -> bool:
        pairs = [
            _pair_key(self.accounts[0], self.accounts[1]),
            _pair_key(self.accounts[0], self.accounts[2]),
            _pair_key(self.accounts[1], self.accounts[2]),
        ]
        for a, b in pairs:
            if not await self._negotiate_pair(a, b, timeout_s):
                return False
        return True

    async def _on_dc_open(self, self_account: str, remote_account: str):
        """Flush pending rows to `remote_account` when our DC to them opens."""
        store = self.pending_by_sender.get(self_account)
        if store is None:
            return
        peer = self._peer(self_account, remote_account)
        if not peer.data_channel_open.is_set():
            return
        for row in store.pending_for_recipient(remote_account):
            peer.send_chat_message_envelope(
                body=row['body'],
                client_msg_id=row['clientMsgId'],
                send_timestamp=row['createdAt'],
            )

    def _handle_inbound_ack(self, recipient: str, envelope: dict):
        client_msg_id = envelope.get('clientMsgId')
        sender = envelope.get('from')
        if not client_msg_id or not sender:
            return
        for acct, store in self.pending_by_sender.items():
            for row in store.rows:
                if row['clientMsgId'] == client_msg_id and row['from'] == acct:
                    store.mark_delivered(client_msg_id, sender)

    async def _client_ready(self, ws, instance_id: str):
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

    async def _join_session(self, ws, instance_id: str):
        await ws.send(
            json.dumps(
                {
                    't': 'joinSession',
                    'sessionId': self.session_id,
                    'clientInstanceId': instance_id,
                }
            )
        )

    async def connect_and_join(
        self,
        *,
        unix_connect,
        url: str,
        tokens: dict[str, str],
        join_order: list[str] | None = None,
        join_stagger_ms: list[int] | None = None,
        timeout_s: float = 45.0,
    ) -> bool:
        join_order = join_order or list(self.accounts)
        if join_stagger_ms is None:
            join_stagger_ms = [0] * len(join_order)

        ok = False
        contexts: list[tuple[str, Any, Any]] = []
        try:
            for acct in self.accounts:
                headers = [('Authorization', f'Bearer {tokens[acct]}')]
                ctx = unix_connect(url, headers)
                ws = await ctx.__aenter__()
                contexts.append((acct, ctx, ws))
                self.ws[acct] = ws
                router = _WsRouter(ws, acct)
                self.routers[acct] = router
                await router.wait_for(lambda m: m['t'] == 'welcome', f'{acct}-welcome')
                await router.wait_for(
                    lambda m: m['t'] == 'presenceSnapshot', f'{acct}-presence'
                )

            for acct in self.accounts:
                await self._client_ready(self.ws[acct], f'mesh-{acct}')

            await asyncio.sleep(0.2)

            self._pump_task = asyncio.create_task(self._pump_outbound())
            for acct in self.accounts:
                self._signal_tasks.append(
                    asyncio.create_task(self._signal_loop(acct))
                )

            await self._setup_all_peers()

            for idx, acct in enumerate(join_order):
                if join_stagger_ms[idx] > 0:
                    await asyncio.sleep(join_stagger_ms[idx] / 1000.0)
                await self._join_session(self.ws[acct], f'mesh-{acct}-join')
                await self.routers[acct].wait_for(
                    lambda m: m['t'] == 'sessionInvite', f'{acct}-invite'
                )

            for acct in self.accounts:
                for _ in range(len(self.accounts) - 1):
                    try:
                        await self.routers[acct].wait_for(
                            lambda m: m.get('t') == 'participantJoined',
                            f'{acct}-joined-drain',
                            timeout=2.0,
                        )
                    except RuntimeError:
                        break

            ok = await self._negotiate_full_mesh(timeout_s)
            return ok
        finally:
            if not ok:
                for _acct, ctx, _ws in contexts:
                    try:
                        await ctx.__aexit__(None, None, None)
                    except Exception:
                        pass
                await self.teardown()

    async def send_group_message(self, sender: str, body: str, client_msg_id: str):
        store = self.pending_by_sender[sender]
        store.enqueue(sender=sender, body=body, client_msg_id=client_msg_id)
        for remote in self.accounts:
            if remote == sender:
                continue
            peer = self._peer(sender, remote)
            if peer.data_channel_open.is_set():
                peer.send_chat_message_envelope(
                    body=body,
                    client_msg_id=client_msg_id,
                )

    def bodies_received_by(self, account: str) -> set[str]:
        bodies: set[str] = set()
        for remote in self.accounts:
            if remote == account:
                continue
            bodies.update(self._peer(account, remote).received_bodies)
        return bodies

    async def wait_for_bodies(
        self, account: str, expected: set[str], timeout_s: float = 10.0
    ) -> bool:
        deadline = asyncio.get_event_loop().time() + timeout_s
        while asyncio.get_event_loop().time() < deadline:
            if expected.issubset(self.bodies_received_by(account)):
                return True
            await asyncio.sleep(0.05)
        return False

    async def teardown(self):
        if self._pump_task is not None:
            self._pump_task.cancel()
            self._pump_task = None
        for task in self._signal_tasks:
            task.cancel()
        self._signal_tasks.clear()
        for router in self.routers.values():
            router.stop()
        for peer in self.peers.values():
            await peer.close()
        self.peers.clear()
        self.routers.clear()
        self.ws.clear()


async def run_chat_data_p2p_group_three_party_roundtrip(
    *,
    unix_connect,
    url: str,
    session_id: str,
    space_uuid: str,
    alice: str,
    bob: str,
    carol: str,
    token_alice: str,
    token_bob: str,
    token_carol: str,
    timeout_s: float = 60.0,
    use_host_only_ice: bool = True,
    rng_seed: int | None = 42,
) -> dict[str, Any]:
    """3-party mesh: staggered joins; each peer sends one group message; all receive all."""
    if not aiortc_available():
        raise RuntimeError('aiortc not installed (pip install aiortc)')

    accounts = [alice, bob, carol]
    rng = random.Random(rng_seed)
    join_order = accounts[:]
    rng.shuffle(join_order)
    join_stagger_ms = [rng.randint(0, 800) for _ in join_order]

    mesh = _GroupMeshSession(
        accounts=accounts,
        session_id=session_id,
        space_uuid=space_uuid,
        use_host_only_ice=use_host_only_ice,
    )

    tokens = {alice: token_alice, bob: token_bob, carol: token_carol}
    mesh_ok = False
    try:
        mesh_ok = await mesh.connect_and_join(
            unix_connect=unix_connect,
            url=url,
            tokens=tokens,
            join_order=join_order,
            join_stagger_ms=join_stagger_ms,
            timeout_s=timeout_s,
        )
        if not mesh_ok:
            return {
                'ok': False,
                'meshOk': False,
                'joinOrder': join_order,
                'joinStaggerMs': join_stagger_ms,
            }

        messages = {
            alice: 'hello-from-alice-group',
            bob: 'hello-from-bob-group',
            carol: 'hello-from-carol-group',
        }
        for sender, body in messages.items():
            await mesh.send_group_message(
                sender, body, client_msg_id=f'{sender}-roundtrip-1'
            )
            await asyncio.sleep(0.15)

        expected = set(messages.values())
        received: dict[str, list[str]] = {}
        all_ok = True
        for acct in accounts:
            ok = await mesh.wait_for_bodies(acct, expected, timeout_s=12.0)
            received[acct] = sorted(mesh.bodies_received_by(acct))
            if not ok:
                all_ok = False

        pending_cleared = all(
            row['status'] == 'sent'
            for store in mesh.pending_by_sender.values()
            for row in store.rows
        )

        return {
            'ok': all_ok and pending_cleared,
            'meshOk': mesh_ok,
            'joinOrder': join_order,
            'joinStaggerMs': join_stagger_ms,
            'received': received,
            'pendingCleared': pending_cleared,
        }
    finally:
        await mesh.teardown()


async def run_chat_data_p2p_group_offline_member_catchup(
    *,
    unix_connect,
    url: str,
    session_id: str,
    space_uuid: str,
    alice: str,
    bob: str,
    carol: str,
    token_alice: str,
    token_bob: str,
    token_carol: str,
    timeout_s: float = 60.0,
    use_host_only_ice: bool = True,
    rejoin_delay_s: float = 0.5,
) -> dict[str, Any]:
    """A+B+C mesh up; A closes WS; B sends group msg; C receives; A rejoins and receives."""
    if not aiortc_available():
        raise RuntimeError('aiortc not installed (pip install aiortc)')

    accounts = [alice, bob, carol]
    tokens = {alice: token_alice, bob: token_bob, carol: token_carol}
    away_msg = 'while-alice-was-away'
    baseline_msg = 'baseline-group-ok'

    mesh = _GroupMeshSession(
        accounts=accounts,
        session_id=session_id,
        space_uuid=space_uuid,
        use_host_only_ice=use_host_only_ice,
    )

    alice_ctx = None
    bob_ctx = None
    carol_ctx = None
    initial_ok = False
    carol_got_away = False
    alice_got_away = False

    try:
        # Phase 1: all three online, full mesh.
        headers = {a: [('Authorization', f'Bearer {tokens[a]}')] for a in accounts}
        alice_ctx = unix_connect(url, headers[alice])
        bob_ctx = unix_connect(url, headers[bob])
        carol_ctx = unix_connect(url, headers[carol])
        ws_a = await alice_ctx.__aenter__()
        ws_b = await bob_ctx.__aenter__()
        ws_c = await carol_ctx.__aenter__()
        mesh.ws = {alice: ws_a, bob: ws_b, carol: ws_c}
        for acct, ws in mesh.ws.items():
            mesh.routers[acct] = _WsRouter(ws, acct)
            await mesh.routers[acct].wait_for(
                lambda m: m['t'] == 'welcome', f'{acct}-welcome'
            )
            await mesh.routers[acct].wait_for(
                lambda m: m['t'] == 'presenceSnapshot', f'{acct}-presence'
            )
            await mesh._client_ready(ws, f'catchup-{acct}')

        mesh._pump_task = asyncio.create_task(mesh._pump_outbound())
        for acct in accounts:
            mesh._signal_tasks.append(asyncio.create_task(mesh._signal_loop(acct)))
        await mesh._setup_all_peers()

        for acct in accounts:
            await mesh._join_session(mesh.ws[acct], f'catchup-{acct}-join')
            await mesh.routers[acct].wait_for(
                lambda m: m['t'] == 'sessionInvite', f'{acct}-invite'
            )
        for acct in accounts:
            for _ in range(2):
                try:
                    await mesh.routers[acct].wait_for(
                        lambda m: m.get('t') == 'participantJoined',
                        f'{acct}-joined',
                        timeout=2.0,
                    )
                except RuntimeError:
                    break

        initial_ok = await mesh._negotiate_full_mesh(timeout_s)
        if initial_ok:
            await mesh.send_group_message(alice, baseline_msg, 'baseline-1')
            initial_ok = await mesh.wait_for_bodies(
                bob, {baseline_msg}, timeout_s=8.0
            )

        # Phase 2: Alice leaves (close WS + tear down alice peers).
        for key in list(mesh.peers.keys()):
            if key[0] == alice or key[1] == alice:
                await mesh.peers[key].close()
                del mesh.peers[key]
        mesh.routers[alice].stop()
        mesh._signal_tasks = [
            t for t in mesh._signal_tasks if t.done() or t.cancel()
        ]
        for t in mesh._signal_tasks:
            t.cancel()
        mesh._signal_tasks = []
        for acct in (bob, carol):
            mesh._signal_tasks.append(asyncio.create_task(mesh._signal_loop(acct)))
        await alice_ctx.__aexit__(None, None, None)
        del mesh.ws[alice]
        del mesh.routers[alice]
        await asyncio.sleep(rejoin_delay_s)

        # Phase 3: Bob sends while Alice is away.
        await mesh.send_group_message(bob, away_msg, 'away-for-alice-1')
        carol_got_away = await mesh.wait_for_bodies(
            carol, {away_msg}, timeout_s=10.0
        )

        # Phase 4: Alice rejoins on fresh WS.
        await asyncio.sleep(rejoin_delay_s)
        alice_ctx2 = unix_connect(url, headers[alice])
        ws_a2 = await alice_ctx2.__aenter__()
        mesh.ws[alice] = ws_a2
        mesh.routers[alice] = _WsRouter(ws_a2, alice)
        await mesh.routers[alice].wait_for(
            lambda m: m['t'] == 'welcome', 'alice-rejoin-welcome'
        )
        await mesh.routers[alice].wait_for(
            lambda m: m['t'] == 'presenceSnapshot', 'alice-rejoin-presence'
        )
        await mesh._client_ready(ws_a2, 'catchup-alice-rejoin')
        mesh._signal_tasks.append(asyncio.create_task(mesh._signal_loop(alice)))
        await mesh._setup_all_peers()
        await mesh._join_session(ws_a2, 'catchup-alice-rejoin-join')
        await mesh.routers[alice].wait_for(
            lambda m: m['t'] == 'sessionInvite', 'alice-rejoin-invite'
        )
        # Bob/carol should see participantJoined for alice.
        for peer in (bob, carol):
            try:
                await mesh.routers[peer].wait_for(
                    lambda m, a=alice: m.get('t') == 'participantJoined'
                    and m.get('participant') == a,
                    f'{peer}-sees-alice-rejoin',
                    timeout=8.0,
                )
            except RuntimeError:
                pass

        # Renegotiate alice's pairwise legs; flush bob's pending to alice on DC open.
        for remote in (bob, carol):
            await mesh._negotiate_pair(alice, remote, timeout_s)

        # Simulate production: bob flushes pending to alice when A↔B DC opens.
        bob_store = mesh.pending_by_sender[bob]
        for row in bob_store.pending_for_recipient(alice):
            mesh._peer(bob, alice).send_chat_message_envelope(
                body=row['body'],
                client_msg_id=row['clientMsgId'],
                send_timestamp=row['createdAt'],
            )

        alice_got_away = await mesh.wait_for_bodies(
            alice, {away_msg}, timeout_s=12.0
        )

        await alice_ctx2.__aexit__(None, None, None)

    finally:
        await mesh.teardown()
        if bob_ctx is not None:
            try:
                await bob_ctx.__aexit__(None, None, None)
            except Exception:
                pass
        if carol_ctx is not None:
            try:
                await carol_ctx.__aexit__(None, None, None)
            except Exception:
                pass

    return {
        'initialMeshOk': initial_ok,
        'carolReceivedWhileAliceAway': carol_got_away,
        'aliceReceivedAfterRejoin': alice_got_away,
        'ok': initial_ok and carol_got_away and alice_got_away,
    }


async def run_chat_data_p2p_group_pending_before_peers_open(
    *,
    unix_connect,
    url: str,
    session_id: str,
    space_uuid: str,
    alice: str,
    bob: str,
    carol: str,
    token_alice: str,
    token_bob: str,
    token_carol: str,
    timeout_s: float = 60.0,
    use_host_only_ice: bool = True,
) -> dict[str, Any]:
    """Alice sends before Bob/Carol joinSession; pending until mesh is ready."""
    if not aiortc_available():
        raise RuntimeError('aiortc not installed (pip install aiortc)')

    accounts = [alice, bob, carol]
    tokens = {alice: token_alice, bob: token_bob, carol: token_carol}
    queued_body = 'queued-before-peers-opened'

    mesh = _GroupMeshSession(
        accounts=accounts,
        session_id=session_id,
        space_uuid=space_uuid,
        use_host_only_ice=use_host_only_ice,
    )

    try:
        headers = {a: [('Authorization', f'Bearer {tokens[a]}')] for a in accounts}
        contexts = {}
        for acct in accounts:
            ctx = unix_connect(url, headers[acct])
            ws = await ctx.__aenter__()
            contexts[acct] = ctx
            mesh.ws[acct] = ws
            mesh.routers[acct] = _WsRouter(ws, acct)
            await mesh.routers[acct].wait_for(
                lambda m: m['t'] == 'welcome', f'{acct}-welcome'
            )
            await mesh.routers[acct].wait_for(
                lambda m: m['t'] == 'presenceSnapshot', f'{acct}-presence'
            )
            await mesh._client_ready(ws, f'pending-{acct}')

        mesh._pump_task = asyncio.create_task(mesh._pump_outbound())
        for acct in accounts:
            mesh._signal_tasks.append(asyncio.create_task(mesh._signal_loop(acct)))
        await mesh._setup_all_peers()

        # Alice joins alone and queues a message before others join.
        await mesh._join_session(mesh.ws[alice], 'pending-alice-join')
        await mesh.routers[alice].wait_for(
            lambda m: m['t'] == 'sessionInvite', 'alice-invite'
        )
        await mesh.send_group_message(alice, queued_body, 'pending-early-1')
        pending_before = mesh.pending_by_sender[alice].rows[0]['status'] == 'pending'

        for acct in (bob, carol):
            await mesh._join_session(mesh.ws[acct], f'pending-{acct}-join')
            await mesh.routers[acct].wait_for(
                lambda m: m['t'] == 'sessionInvite', f'{acct}-invite'
            )
        for acct in accounts:
            for _ in range(2):
                try:
                    await mesh.routers[acct].wait_for(
                        lambda m: m.get('t') == 'participantJoined',
                        f'{acct}-joined',
                        timeout=2.0,
                    )
                except RuntimeError:
                    break

        mesh_ok = await mesh._negotiate_full_mesh(timeout_s)
        bob_ok = await mesh.wait_for_bodies(bob, {queued_body}, timeout_s=12.0)
        carol_ok = await mesh.wait_for_bodies(carol, {queued_body}, timeout_s=12.0)
        pending_cleared = mesh.pending_by_sender[alice].rows[0]['status'] == 'sent'

        for ctx in contexts.values():
            await ctx.__aexit__(None, None, None)

        return {
            'ok': mesh_ok and pending_before and bob_ok and carol_ok and pending_cleared,
            'meshOk': mesh_ok,
            'pendingBeforeJoin': pending_before,
            'bobReceived': bob_ok,
            'carolReceived': carol_ok,
            'pendingCleared': pending_cleared,
        }
    finally:
        await mesh.teardown()
