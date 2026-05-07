# x-pslack

`x-pslack` is a node-local subjective websocket service for realtime chat. The
v1 websocket endpoint is `/ws` and uses the `psibase.pslack.v1` subprotocol.
Browser clients that cannot set websocket `Authorization` headers may include a
second subprotocol, `psibase.bearer.<token>`, during the upgrade.
All application frames are websocket text messages containing one JSON object
with a case-sensitive `t` discriminator and camelCase fields.

## v1 Client Frames

- `{"t":"sync","knownConversationIds":["..."]}` requests contact presence and
  conversation snapshots. `knownConversationIds` is optional and defaults to an
  empty list.
- `{"t":"openDm","member":"account"}` opens the direct-message conversation
  between the authenticated user and another account.
- `{"t":"openGroup","members":["account","account"]}` opens a group
  conversation containing the authenticated user plus at least two distinct
  other accounts.
- `{"t":"say","conversationId":"...","body":"...","clientMsgId":"..."}`
  sends text to a conversation.
- `{"t":"ack","conversationId":"...","serverMsgId":1}` confirms delivery of a
  server message to this client.
- `{"t":"ping"}` requests an application-level liveness response.
- `{"t":"signal","conversationId":"...","to":"account","payload":{...}}` is
  reserved for a future WebRTC signaling phase. The schema is parsed in v1, but
  the service rejects it with a reserved-signal protocol error.

## v1 Server Frames

- `{"t":"welcome","user":"account","serverTime":0}` confirms the authenticated
  user after the websocket handshake.
- `{"t":"sync","contacts":[{"account":"...","presence":"online"}],"conversations":[...]}`
  returns a sidebar snapshot.
- `{"t":"conversation","conversationId":"...","kind":"dm","members":["..."]}`
  confirms an opened DM or group conversation.
- `{"t":"presence","account":"...","status":"online","socketCount":1}` sends a
  contact presence delta. `status` is `online` or `offline`; `socketCount` is
  optional.
- `{"t":"message","conversationId":"...","from":"account","body":"...","serverMsgId":1,"serverTime":0,"clientMsgId":"..."}`
  fans out a chat message. `clientMsgId` is present when the sender supplied it.
- `{"t":"delivered","conversationId":"...","serverMsgId":1,"to":"account"}`
  reports delivery state.
- `{"t":"error","code":"...","reason":"...","conversationId":"..."}` reports a
  protocol or authorization error. `conversationId` is optional.
- `{"t":"pong"}` replies to `ping`.

Account fields use psibase account string syntax. Conversation member sets are
validated before use: DMs must target a different account, and groups must not
include the current user, duplicate members, or fewer than two other members.

## WebSocket subprotocol v2 — `psibase.pslack.v2`

Media Meet uses the same `/ws` endpoint with a bumped subprotocol (`psibase.pslack.v2`).
During the upgrade, offer `Sec-WebSocket-Protocol: psibase.pslack.v2, psibase.pslack.v1`
so the server can select v2; v1 remains available for chat-only clients.

Immediately after `welcome`, v2 sessions receive a one-shot ICE config:

- Default **STUN** entries (Google + Cloudflare) are always included.
- Optional **TURN** entries come from **OpenRelay / Metered** credentials stored node-locally
  via the x-admin **Pslack** tab (`GET`/`PUT` `/pslack/openrelay` on `x-admin`). The UI fetches
  `https://{app}.metered.live/api/v1/turn/credentials?apiKey=…` and saves the resulting
  `iceServers` JSON array; `x-pslack` reads it through the `x-admin` action
  `pslackTurnIceServersJson` (callable only from `x-pslack`) and merges it into the
  `iceServers` frame.
- If no valid TURN credentials are cached (missing config, fetch failure, quota exhaustion, or
  invalid JSON), clients still receive **STUN-only** ICE and may connect on favorable networks.
  Otherwise they fail with `callHangup` `reason: ice-failed` and a timeline `callEvent` with
  `event: failed`, `reason: ice-failed`.

### Manual check: TURN relay (operators)

1. Configure OpenRelay in x-admin **Pslack** (fetch or paste credentials).
2. Open DM Meet between two browsers on networks that **cannot** complete ICE with STUN only
   (e.g. restrictive NAT/firewall); confirm the call connects when TURN is configured.
3. Clear OpenRelay cache on the node and repeat; confirm calls fall back to STUN-only behavior
   or fail with `ice-failed` as expected.

All v1 frames stay valid on v2 sockets. **Additional v2 client frames** (DM signaling + media
state, opaque SDP/ICE strings):

- `callInvite` `{ conversationId, wantVideo, wantAudio, clientCallId }`
- `callAccept` / `callDecline` / `callHangup` `{ callId, reason? }`
- `callOffer` / `callAnswer` `{ callId, sdp }`
- `callCandidate` `{ callId, candidate?, sdpMid?, sdpMLineIndex? }`
- `callMediaState` `{ callId, audioMuted, videoMuted }`

**Mirrored server routing frames** (same `t` names, server-originated payloads) include
`callInvite`, `callAccept`, `callDecline`, `callHangup`, `callOffer`, `callAnswer`,
`callCandidate`, `callMediaState`.

**DM-only calls:** `callInvite` on a group conversation returns `callError` `code: not-dm`.
Authorization and busy/peer-busy/collision semantics are enforced in the subjective call
tables; coverage lives in `programs/psinode/tests/test_pslack_call.py` and Rust unit tests
under `packages/local/XPSlack/service`.

### `callEvent` timeline rows (chat history)

Server emits `callEvent` for both DM members to append to the DM timeline:

```json
{"t":"callEvent","conversationId":"…","callId":"…","event":"started|ended|missed|declined|cancelled|failed","actor":"alice?","reason":"timeout|ice-failed|transport?","durationMs":1234,"serverMsgId":0,"serverTime":0}
```

- `event` is lowercase.
- `durationMs` appears on `ended` when the service can compute call duration.
- `failed` uses `reason` such as `transport` (signaling socket loss) or `ice-failed`.

On a v1 websocket, structured call actions still parse but are answered with
`callError` `not-implemented`; upgrade to v2 for Meet.
