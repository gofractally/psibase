# Chat transport (`apps/chat/transport/`)

Per-peer WebRTC mesh stack (L1 WebSocket → L2 pair signaling → L3 peer
connections → L4 messaging) plus the app-facing façades built on top of it.
Full design rationale, FSMs, and glossary live in
[`../chat-data-transport-per-peer.md`](../chat-data-transport-per-peer.md);
this file is the **short "what can app code call" reference**.

## Rule for app code (Chat UI, Meet, hooks)

**Talk to `DeliveryFabric` / `PeerMediaPort` / `MessagingService` — never to
L1/L2/L3 internals directly** (`RealtimeTransport`, `PairSignaling`,
`PeerTransportRegistry`, `PeerLifecycleCoordinator`). Those are wired together
once, inside `stack.ts`, and are implementation details of the mesh.

```text
apps/chat/hooks/…            (React composition root)
       │
       ▼
ChatTransportBridge           ← Chat adapter (session ensure, history sync, ACK wiring)
       │
       ▼
DeliveryFabric / MessagingService   ← app-facing façades (this file's public surface)
       │
       ▼
createChatTransportStack()    ← L1–L4 composition root (stack.ts)
       │
       ├── L4 MessagingService       (l4-messaging-service.ts)
       ├── L3 PeerTransportRegistry  (l3-peer-registry.ts)
       ├── L2 PairSignaling          (l2-pair-signaling.ts)
       └── L1 RealtimeTransport      (l1-realtime-transport.ts → shared-ui RealtimeClient)
```

## Public surface for app code

### `DeliveryFabric` (`delivery-fabric.ts`)

Thin façade over L1 + `PeerLifecycleCoordinator` + L3. Use this for anything
that isn't Chat-message send/receive (presence-gated peer ensure, opaque byte
send, Meet media attach):

```typescript
type DeliveryFabric = {
    ensurePeer(remote: string, reason: EnsureReason): Promise<void>;
    sendPeerBytes(remote: string, bytes: Uint8Array): SendResult;
    sendNodeControl(frame: ClientRealtimeFrame): void;
    startPeerMedia(opts: SharedMeetPeerOptions): MeetPeerHandle;
    getPeerCapability(remote: string): PeerCapability;
    getPeerState(remote: string): PeerState;
    disposePeer(remote: string, reason: string): void;
    recoverPeer(remote: string, reason: string): void;
    touchPeer(remote: string): void;
    asPeerMediaPort(): PeerMediaPort;
    notifyRemoteReachable(remote: string, source: EnsureReason): void;
};
```

### `PeerMediaPort` (`peer-media-port.ts`)

Narrower port that `SharedMeetPeer` (Meet) needs — obtained via
`fabric.asPeerMediaPort()`, not constructed directly:

```typescript
type PeerMediaPort = {
    ensure(remote: string, reason: EnsureReason): Promise<void>;
    getChatPeer(remote: string): ChatDataWebRtcPeer | null;
    holdMeet(remote: string): void;
    releaseMeet(remote: string): void;
};
```

### `MessagingService` (`l4-messaging-service.ts`)

Chat-message send/receive, ACK, and durable outbox. `send` / `sendGroup`
return quickly (accepted into outbox); delivery status comes via events:

```typescript
interface MessagingService {
    send(req: SendRequest): Promise<{ msgId: string }>;
    sendGroup(req: SendGroupRequest): Promise<{ msgId: string }>;
    getStatus(msgId: string): MessageStatus;
    getPendingCount(msgId: string): PendingCount;
    onStatusChange(handler): Unsubscribe;
    onInbound(handler): Unsubscribe;
    onHistorySync(handler): Unsubscribe;
    onSpaceMembershipHint(handler): Unsubscribe;
    onRecipientDelivered(handler): Unsubscribe;
    hydrateFromStorage(): void;
    /** Focused-space flush priority (H28) — owned here, not by the app. */
    setFocusedSpace(spaceUuid: string | null | undefined): void;
    acknowledgeInbound(remote: string, spaceUuid: string, clientMsgId: string): void;
}
```

### `ChatTransportBridge` (`chat-transport-bridge.ts`)

Chat's composition adapter: constructs the stack, wires inbound demux
(`chatMessage` / `chatHistorySync` / `messageAck` → L4; everything else → app
callback), and exposes `messaging` / `deliveryFabric` / `peerLifecycle`
getters plus navigation suspend/resume. This is what
`hooks/chat/use-chat-transport-lifecycle.ts` and `use-chat-messaging.ts` hold
a ref to — see the "`ChatTransportBridge` — bridge" section in
[`../chat-data-transport-per-peer.md`](../chat-data-transport-per-peer.md)
for the full method table.

## Module map

| File | Layer / role |
| --- | --- |
| `types.ts` | Shared constants (`PEER_IDLE_TTL_MS`, `MAX_VALID_ATTEMPTS`, …) |
| `pair-id.ts` | `pairSessionId`, lex initiator helpers |
| `event-bus.ts` | Internal pub/sub |
| `l1-realtime-transport.ts` | **L1** — WebSocket (wraps shared-ui `RealtimeClient`) |
| `l2-pair-signaling.ts` | **L2** — pair session join/signal/leave, `joinedPairs` (sole owner — M5) |
| `roster-renegotiation-coordinator.ts` | Debounced roster-driven renegotiation for L3 |
| `negotiation-scheduler.ts` | Offer/answer/ICE scheduling helper for L3 |
| `l3-peer-registry.ts` | **L3** — per-remote `RTCPeerConnection` FSM, TTL/LRU cap; opaque bytes only (M4 — no chat `t:` dispatch here) |
| `peer-lifecycle-coordinator.ts` | Sole `ensure` / `kick` / `recover` owner over L3 |
| `delivery-coordinator.ts` | L4-internal outbox/in-flight/ACK helper |
| `l4-messaging-service.ts` | **L4** — public messaging API; chat `t:` framing (`chatMessage` / `chatHistorySync` / `messageAck`) lives here |
| `delivery-fabric.ts` | App-facing façade over L1 + peer lifecycle + L3 |
| `peer-media-port.ts` | Narrow port for Meet (`SharedMeetPeer`) via the fabric |
| `chat-transport-bridge.ts` | Chat adapter composing the stack for `use-chat-*` hooks |
| `stack.ts` | Composition root — `createChatTransportStack()` |
| `index.ts` | Barrel exports |

## Meet: decline / timeout / rejoin (P3.2)

Decline, ringing-timeout, and rejoin behavior are **not** in one giant file —
they're already split by concern under `apps/chat/lib/`:

| Concern | Module |
| --- | --- |
| Terminal event mapping (declined / timed-out / failed) | `lib/av-call-terminal.ts` |
| DM call FSM (including decline/timeout transitions) | `lib/av-call-run-state-machine.ts`, `lib/av-call-run-actor.ts` |
| Group attempt lifecycle (invite/accept/decline/timeout per participant) | `lib/group-meet-attempt-coordinator.ts` |
| Group rejoin / voluntary-leave policy | `lib/av-call-group-orchestrator.ts`, `lib/group-meet-voluntary-leave.ts` |
| Rejoin UI state derivation | `lib/group-meet-lifecycle-ui.ts` |
| Rejoin banner component | `components/group-meet-rejoin-banner.tsx` |

These already map close to 1:1 with the PR7 sub-slices in `webrtc_pr_plan.md`
(decline/timeout vs group mesh) — no further extraction needed pre-lock.
