# x-wrtcsig (`packages/local/XWebRtcSig`)

Node-local subjective websocket service for WebRTC signaling, presence, and ICE
relay. Chat message bodies are not sent on this websocket.

## Role

- Authenticate `/ws` connections and send `welcome` (including ICE servers).
- Fan out contact-scoped presence snapshots/deltas.
- Route `joinSession` / `signal` / `leaveSession` against objective Chat
  `authorizeSessionJoin`, and wire lifecycle events back via
  `webrtcSessionEvent`.

## Layout

| Path | Purpose |
| --- | --- |
| `service/src/lib.rs` | Thin `#[psibase::service]` actions (`serveSys` / `recv` / `close` / `errSys`) |
| `service/src/http/` | Routing, WS handshake, frame delivery, socket cleanup |
| `service/src/protocol/` | `psibase.realtime.v1` frame types + codec |
| `service/src/signaling/` | Join / signal / leave / roster fanout / teardown |
| `service/src/state/` | Subjective socket/session tables + tx wrappers |
| `service/src/cleanup.rs` | Stale ringing/session sweep |
| `service/src/presence.rs` | Online presence fanout |
| `service/src/ice_config.rs` | Default STUN + node TURN merge |
| `tests/python/` | Slow integration/e2e (not in default ctest) |

Service account: `x-wrtcsig` (`AccountNumber` max length is 10). Subprotocol:
`psibase.realtime.v1`.

TURN credentials are stored node-locally by `x-admin`; this service reads ICE
JSON via `turnIceServersJson` and merges it with default STUN for welcome.

## Tests

- **Unit (ctest `rs-test-XWebRtcSig`):** `cargo-psibase test` on `service/`.
- **E2E:** `tests/python/test_xwebrtcsig.py` — run manually; not wired into CMake
  (see repo-root `webrtc-test-plan.md`).

### Python E2E: smoke subset vs full suite

`tests/python/test_xwebrtcsig.py` has two classes:

- `TestXWebRtcSig` — WS auth, presence, and join/signal/leave cases against a
  real `psinode`. No extra Python deps beyond `programs/psinode/tests/`.
- `TestChatDataP2pHarness(TestXWebRtcSig)` — adds real aiortc P2P cases
  (`test_chat_data_p2p_*`); requires `pip install aiortc` or those cases
  self-skip (`aiortc_available()` guard). Since it subclasses
  `TestXWebRtcSig`, running this class also re-runs every base case.

For a fast PR2-style smoke pass (auth + presence + one join), run just:

- `TestXWebRtcSig.test_ws_bearer_auth_welcome` — authed WS handshake gets `welcome`
- `TestXWebRtcSig.test_ws_unauthenticated_rejected` — unauthenticated upgrade rejected
- `TestXWebRtcSig.test_presence_fanout_on_connect` — presence delta fans out to peers
- `TestXWebRtcSig.test_chat_data_join_session_invite` — one `joinSession` → `sessionInvite` case

```bash
PYTHONPATH=programs/psinode/tests \
PSIBASE_PACKAGE_DIR=build/share/psibase/packages \
python packages/local/XWebRtcSig/tests/python/test_xwebrtcsig.py \
  --psinode=build/psinode \
  TestXWebRtcSig.test_ws_bearer_auth_welcome \
  TestXWebRtcSig.test_ws_unauthenticated_rejected \
  TestXWebRtcSig.test_presence_fanout_on_connect \
  TestXWebRtcSig.test_chat_data_join_session_invite
```

Full suite (all WS cases plus aiortc P2P mesh/group/rejoin/catch-up cases —
slower, needs `aiortc` for full coverage):

```bash
PYTHONPATH=programs/psinode/tests \
PSIBASE_PACKAGE_DIR=build/share/psibase/packages \
python packages/local/XWebRtcSig/tests/python/test_xwebrtcsig.py \
  --psinode=build/psinode
```
