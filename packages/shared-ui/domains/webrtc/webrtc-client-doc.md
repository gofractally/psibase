# WebRTC client guide (PR3)

Shared realtime client for **x-wrtcsig**: authenticated websocket, peer
presence, and signaling frame helpers. Homepage’s PR3 tip mounts this for
**presence only**; join/Meet/messaging UI lands in later extract PRs.

## What this package gives you

`packages/shared-ui/domains/webrtc` owns **page-scoped** transport for the
node-local `x-wrtcsig` service:

| Capability | Provided here? | Notes |
| --- | --- | --- |
| Authenticated `/ws` (`psibase.realtime.v1`) | Yes | Bearer subprotocol via your token provider |
| Reconnect + connect timeout | Yes | Exponential backoff + rapid-close storm guard |
| Health ping/pong watchdog | Yes | Force-reconnect when the socket goes silent |
| `welcome` (account + ICE servers) | Yes | Exposed as `welcomeReady` on the React context |
| Peer presence snapshot/delta | Yes | Via `registerHandlers` (`peers` on snapshot) |
| Session invite / join / leave / signal | Yes (API) | Frames + `WebRtcSignalingClient`; unused by PR3 presence UI |
| Objective Chat Spaces / timeline | No | Later Homepage Chat PRs |
| Data-channel / Meet A/V | No | Later extract PRs |

The websocket **does not** survive subdomain navigation, tab close, or
cross-origin hops.

Related packages on this stack tip:

- `packages/local/XWebRtcSig` — subjective signaling / presence / ICE merge (PR2)
- `packages/user/Chat` — objective Spaces / sessions (PR1)
- `packages/user/Homepage/ui/src/apps/chat` — presence mount (this PR)

---

## Minimal integration (presence)

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
Homepage uses `getHomepageQueryToken` in
`packages/user/Homepage/ui/src/apps/chat/lib/ws-auth.ts` (Supervisor
`host/auth` → `get-active-query-token` for `"homepage"`).

Reference shell: `packages/user/Homepage/ui/src/apps/chat/chat-app-shell.tsx`.

`WebRtcSessionProvider` owns the websocket for **one page mount** — not a Chat
on-chain `session_id`.

### 2. Subscribe to presence

```tsx
function MyFeature() {
    const { connectionState, welcomeReady, registerHandlers } =
        useWebRtcSession();

    useEffect(() => {
        return registerHandlers({
            presenceSnapshot: (frame) => {
                /* seed peer online map from frame.peers */
            },
            presence: (frame) => {
                /* apply delta */
            },
        });
    }, [registerHandlers]);

    if (!welcomeReady) return null;
    // ...
}
```

Homepage reference: `hooks/use-realtime-presence.ts`,
`pages/realtime-presence-page.tsx`,
`components/realtime-connection-indicator.tsx`.

### 3. Signaling helpers (available; not used by PR3 UI)

```ts
signaling.joinSession(sessionId);
signaling.signal({
    sessionId,
    to: peerAccount,
    kind: "offer", // or answer | candidate | end-of-candidates
    sdp,
});
signaling.leaveSession(sessionId, "hangup");
```

`WebRtcSignalingClient` no-ops sends until after `welcome` (`isWelcomeReady`).

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
| `welcomeReady` | `true` after first `welcome` on this instance |
| `isReconnectWelcome` | Latest welcome follows an earlier one |
| `connectedAccount` | Account from latest `welcome` |
| `iceServers` | ICE config from latest `welcome` |
| `registerHandlers` | Merge server-frame handlers; returns unsubscribe |
| `reconnectNow` | Immediate reconnect attempt |

### `RealtimeClient`

- `connect()` / `close()` / `reconnectNow()` / `ping()`
- `sendClientFrame(frame)` — post-welcome only
- `registerHandlers` / `setHandlers`
- `instanceId`, `isWelcomeReady`, `welcomeGeneration`, `isReconnectWelcome()`
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

### Schemas

`peerPresenceSchema`, `presenceStatusSchema`, `iceServerConfigSchema` from
`lib/realtime-schemas.ts`.

Golden fixtures (shared with Rust): `fixtures/golden/`.

---

## Feature set (frames)

### Client → server

| `t` | Purpose |
| --- | --- |
| `clientReady` | Sent automatically after `welcome` |
| `ping` | Health (also sent by watchdog) |
| `joinSession` | Attach this client to a Chat session for signaling |
| `signal` | SDP/ICE to one peer |
| `leaveSession` | Leave signaling membership |
| `participantState` | Mute / media readiness hints |

### Server → client

| `t` | Purpose |
| --- | --- |
| `welcome` | Auth ok, ICE list, optional `activeSessions` hints |
| `pong` | Health reply |
| `presenceSnapshot` / `presence` | Peer online map (`peers` on snapshot) |
| `sessionInvite` | Incoming session |
| `participantJoined` / `participantState` | Peer lifecycle |
| `signal` | Remote SDP/ICE |
| `sessionSnapshot` | Joined vs pending roster + epoch |
| `transportLost` | Peer path lost |
| `sessionEnded` | Session closed |
| `error` | Includes ignored `signal-trace` diagnostic code |

Message **bodies** (chat text, custom app payloads) must not travel on this
websocket.

---

## Homepage reference files (PR3 tip)

| Path under `packages/user/Homepage/ui/src/apps/chat/` | Why |
| --- | --- |
| `chat-app-shell.tsx` | Provider mount + reconnect defaults |
| `lib/ws-auth.ts` | Query-token pattern for Homepage origin |
| `hooks/use-realtime-presence.ts` | `presenceSnapshot` / `presence` → UI map |
| `pages/realtime-presence-page.tsx` | Contacts list + connection indicator |
| `components/realtime-connection-indicator.tsx` | Connected / reconnecting / offline pill |
| `pages/presence-contact-row.tsx` | Row + presence dot |

Prefer importing from `@shared/domains/webrtc` in new code.

---

## Debug

```js
localStorage.setItem("webrtc-realtime-trace", "1");
```

Verbose shared-ui websocket logs. Pass `debugLog` into `WebRtcSessionProvider`
for app-specific frame tracing.

---

## Non-goals / pitfalls

- **Do not** put chat or app message bodies on `x-wrtcsig` frames.
- **Do not** assume the provider survives leaving the page or changing
  subdomain; plan for reconnect.
- **Service account** is `x-wrtcsig` (not `x-webrtc-sig` — too long for
  `AccountNumber`).
- **TURN** credentials live in `x-admin`; clients consume the merged ICE list
  from `welcome` (STUN-only until the TURN extract PR).
- Peer/account strings in protocol frames are validated as psibase accounts
  (`zAccount`).
