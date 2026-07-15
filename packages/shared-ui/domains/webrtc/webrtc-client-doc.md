# WebRTC client guide

How to build a new psibase app client on the shared realtime / WebRTC
infrastructure. Goal: get a signed-in websocket, presence, ICE, and session
signaling working with as little custom transport code as possible.

## What this package gives you

`packages/shared-ui/domains/webrtc` owns **page-scoped** transport for the
node-local `x-wrtcsig` service:

| Capability | Provided here? | Notes |
| --- | --- | --- |
| Authenticated `/ws` (`psibase.realtime.v1`) | Yes | Bearer subprotocol via your token provider |
| Reconnect + connect timeout | Yes | Exponential backoff + rapid-close storm guard |
| Health ping/pong watchdog | Yes | Force-reconnect when the socket goes silent |
| `welcome` (account + ICE servers) | Yes | Exposed on the React session context |
| Contact presence snapshot/delta | Yes | Via `registerHandlers` |
| Session invite / join / leave / signal | Yes | Frames + `WebRtcSignalingClient` helpers |
| SDP/ICE fanout between peers | Yes (relay only) | You still build `RTCPeerConnection` |
| Objective Chat Spaces / timeline | No | `chat` service + Homepage Chat UI |
| Data-channel message bodies | No | App-owned (see Homepage chat-data stack) |
| Meet A/V media negotiation | No | App-owned (see Homepage `MeetWebRtcPeer`) |

The websocket **does not** survive subdomain navigation, tab close, or
cross-origin hops. Delivery after disconnect depends on cold rejoin + your
app’s pending/flush logic, not on keeping this connection alive.

Related packages:

- `packages/local/XWebRtcSig` — subjective signaling / presence / ICE merge
- `packages/user/Chat` — objective Spaces, session rows, call timeline
- `packages/user/Homepage/ui/src/apps/chat` — full reference client

---

## Minimal integration

### 1. Mount the provider once per page load

```tsx
import {
    WebRtcSessionProvider,
    useWebRtcSession,
} from "@shared/domains/webrtc";

function AppRoot() {
    return (
        <WebRtcSessionProvider authTokenProvider={getMyAppQueryToken}>
            <MyFeature />
        </WebRtcSessionProvider>
    );
}
```

`authTokenProvider` must return a Bearer query token accepted by `x-wrtcsig`.
Homepage Chat uses `getHomepageQueryToken` in
`packages/user/Homepage/ui/src/apps/chat/lib/ws-auth.ts` (Supervisor
`host/auth` → `get-active-query-token` for the app’s origin account). Copy that
pattern for your app’s service name / logged-in user.

Reference shell: `packages/user/Homepage/ui/src/apps/chat/chat-app-shell.tsx`.

### 2. Read session state and subscribe to frames

```tsx
function MyFeature() {
    const {
        client,
        signaling,
        connectionState,
        sessionReady,
        connectedAccount,
        iceServers,
        registerHandlers,
    } = useWebRtcSession();

    useEffect(() => {
        return registerHandlers({
            presenceSnapshot: (frame) => {
                /* seed contact online map */
            },
            presence: (frame) => {
                /* apply delta */
            },
            sessionInvite: (frame) => {
                /* create/join your RTCPeerConnection(s) */
            },
            signal: (frame) => {
                /* apply remote SDP/ICE */
            },
            sessionSnapshot: (frame) => {
                /* roster / epoch for mesh recovery */
            },
            transportLost: (frame) => {
                /* tear down or renegotiate that peer */
            },
            sessionEnded: (frame) => {
                /* hang up UI */
            },
        });
    }, [registerHandlers]);

    if (!sessionReady || !signaling) return null;
    // ...
}
```

### 3. Join a session and exchange signals

Objective apps (Chat) create the session on-chain first, then peers join over
the websocket:

```ts
signaling.joinSession(sessionId);
signaling.signal({
    sessionId,
    to: peerAccount,
    kind: "offer", // or answer | candidate | end-of-candidates
    sdp,
});
signaling.participantState(sessionId, { audioMuted: true, videoMuted: false });
signaling.leaveSession(sessionId, "hangup");
```

`WebRtcSignalingClient` no-ops sends until after `welcome` (`isSessionReady`).

---

## Public API surface

Import from `@shared/domains/webrtc` (barrel) or deep paths under
`@shared/domains/webrtc/lib/...` / `.../components/...`.

### `WebRtcSessionProvider` / `useWebRtcSession()`

| Field / prop | Meaning |
| --- | --- |
| `authTokenProvider` | `() => Promise<string \| null \| undefined>` |
| `baseUrl` | Optional override for sibling URL resolution |
| `reconnect` | `{ initialDelayMs, maxDelayMs, connectTimeoutMs }` |
| `health` | `{ pingIntervalMs, pongTimeoutMs }` (`0` disables) |
| `autoConnect` | Default `true` |
| `debugLog` | `(event, detail?) => void` app tracing |
| `client` | `RealtimeClient \| null` |
| `signaling` | `WebRtcSignalingClient \| null` |
| `connectionState` | `"offline" \| "reconnecting" \| "connected"` |
| `sessionReady` | `true` after first `welcome` on this instance |
| `isReconnectWelcome` | Latest welcome follows an earlier one |
| `connectedAccount` | Account from latest `welcome` |
| `iceServers` | ICE config from latest `welcome` |
| `registerHandlers` | Merge server-frame handlers; returns unsubscribe |
| `reconnectNow` | Immediate reconnect attempt |

### `RealtimeClient`

Lower-level websocket client if you are not using React, or need to drive
connect yourself:

- `connect()` / `close()` / `reconnectNow()` / `ping()`
- `sendClientFrame(frame)` — post-welcome only
- `registerHandlers` / `setHandlers`
- `instanceId`, `isSessionReady`, `welcomeGeneration`, `isReconnectWelcome()`
- `state`, `lastError`

### `WebRtcSignalingClient`

Thin helpers over client frames: `joinSession`, `leaveSession`, `signal`,
`participantState`.

### Protocol constants and parsers

| Export | Value / role |
| --- | --- |
| `REALTIME_SERVICE` | `"x-wrtcsig"` (account max length 10) |
| `REALTIME_SUBPROTOCOL_V1` | `"psibase.realtime.v1"` |
| `REALTIME_AUTH_SUBPROTOCOL_PREFIX` | `"psibase.bearer."` |
| `parseServerRealtimeFrame` / `parseServerRealtimeFrameText` | Zod-validated inbound frames |
| `ClientRealtimeFrame` / `ServerRealtimeFrame` | Discriminated unions on `t` |

Account fields in frames use shared `@shared/lib/schemas/account` (`zAccount`) —
same rules as other chain-facing UI (length, charset, no `x-` user accounts).

### Schemas

`contactPresenceSchema`, `presenceStatusSchema`, `iceServerConfigSchema` from
`lib/realtime-schemas.ts`.

---

## Feature set (frames)

### Client → server

| `t` | Purpose |
| --- | --- |
| `clientReady` | Sent automatically after `welcome` |
| `ping` | Health (also sent by watchdog) |
| `joinSession` | Attach this client instance to a session |
| `signal` | SDP/ICE to one peer |
| `leaveSession` | Leave / hang up signaling membership |
| `participantState` | Mute / media readiness hints |

### Server → client

| `t` | Purpose |
| --- | --- |
| `welcome` | Auth ok, ICE list, optional `activeSessions` hints |
| `pong` | Health reply |
| `presenceSnapshot` / `presence` | Contact online map |
| `sessionInvite` | Incoming session (purpose, peers, dataChannels, metadata) |
| `participantJoined` / `participantState` | Peer lifecycle |
| `signal` | Remote SDP/ICE |
| `sessionSnapshot` | Joined vs pending roster + epoch |
| `transportLost` | Peer path lost; recoverable via rejoin/renegotiate |
| `sessionEnded` | Session closed |
| `error` | Includes ignored `signal-trace` diagnostic code |

Message **bodies** (chat text, custom app payloads) must not travel on this
websocket. Use WebRTC data channels (or another app channel) for that.

---

## Suggested build order for a new client

1. **Provider + auth token** — see connection indicator UI patterns in Homepage
   Chat components.
2. **Presence** — handle `presenceSnapshot` / `presence`; drive “online” UX.
3. **ICE** — map `iceServers` to `RTCPeerConnection` config. Homepage helpers:
   `lib/ice-config.ts`, `lib/webrtc-local-dev-ice.ts`.
4. **Objective session create/join** — if you use Chat’s model, call the Chat
   plugin / GraphQL (`lib/chat-api.ts`). Other apps need an equivalent
   authorize-join path that `x-wrtcsig` can validate.
5. **Signaling** — `joinSession` + `signal` + apply to `RTCPeerConnection`.
6. **Peer helper** — start from Meet (A/V) or chat-data (data channels) below.
7. **Recovery** — handle `transportLost`, `sessionSnapshot`, reconnect
   `welcome` (`isReconnectWelcome` / `activeSessions`).

---

## Reference files in Homepage / Chat

These are **not** in `shared-ui`; copy or adapt for your app.

### Must-look transport wiring

| Path under `packages/user/Homepage/ui/src/apps/chat/` | Why |
| --- | --- |
| `chat-app-shell.tsx` | Provider mount + reconnect defaults + debugLog |
| `lib/ws-auth.ts` | Query-token pattern for Homepage origin |
| `hooks/use-chat-socket.ts` | End-to-end wiring of handlers, presence, sessions (large; skim structure) |
| `transport/l1-realtime-transport.ts` | Thin adapter: `RealtimeClient` → presence/ready events |
| `transport/l2-pair-signaling.ts` | Pair-oriented SDP/ICE on top of signaling |
| `transport/stack.ts` | How L1–L4 compose for chat-data mesh |
| `transport/index.ts` | Public transport exports |

Homepage also keeps thin re-exports of the shared clients:

- `lib/realtime-client.ts`
- `lib/realtime-protocol.ts`
- `lib/webrtc-signaling-client.ts`

Prefer importing from `@shared/domains/webrtc` in new code.

### Meet (audio/video) reference

| Path | Why |
| --- | --- |
| `lib/meet-webrtc-peer.ts` | `RTCPeerConnection` + media tracks + signaling |
| `lib/local-media.ts` | `getUserMedia` helper |
| `lib/ice-config.ts` | Validate/map welcome ICE → `RTCIceServer[]` |
| `lib/shared-meet-peer.ts` | Shared Meet peer plumbing |
| `lib/av-call-dm-orchestrator.ts` / `lib/av-call-group-orchestrator.ts` | DM vs group call flows |
| `lib/av-call-realtime-handlers.ts` | Mapping server frames → call state |
| `lib/av-call-session-orchestrator.ts` | Session lifecycle / mesh coordination |
| `components/call-view.tsx` | Call UI tiles / mute controls |

### Chat data-channel reference (optional)

Only needed if your app sends opaque peer payloads the way Chat does:

| Path | Why |
| --- | --- |
| `lib/chat-data-webrtc-peer.ts` | Data-channel peer + envelopes |
| `transport/l3-peer-registry.ts` | Per-peer connection registry |
| `transport/l4-messaging-service.ts` | Send/receive / pending flush |
| `lib/pending-message-store.ts` | Durable outbox |
| `lib/dm-message-history-store.ts` / `lib/group-message-history-store.ts` | Local history |

### Objective Chat API (if you share the Chat service)

| Path | Why |
| --- | --- |
| `lib/chat-api.ts` | Plugin writes + authenticated GraphQL reads |
| `packages/user/Chat/README.md` | Service / query / plugin layout |

---

## Debug

```js
localStorage.setItem("webrtc-realtime-trace", "1");
```

Verbose shared-ui websocket logs. Pass `debugLog` into `WebRtcSessionProvider`
for app-specific frame tracing (Chat uses `chatDataRecord`).

Operational triage for the full Chat mesh:
`packages/user/Homepage/ui/src/apps/chat/webrtc-debugging.md`.

---

## Non-goals / pitfalls

- **Do not** put chat or app message bodies on `x-wrtcsig` frames.
- **Do not** assume the provider survives leaving the page or changing
  subdomain; plan for reconnect + rejoin.
- **Service account** is `x-wrtcsig` (not `x-webrtcsig` — too long for
  `AccountNumber`).
- **TURN** credentials live in `x-admin`; clients consume the merged ICE list
  from `welcome`, they do not fetch TURN secrets themselves.
- Peer/account strings in protocol frames are validated as psibase accounts
  (`zAccount`). Invalid names fail frame parse instead of silently flowing
  through.
