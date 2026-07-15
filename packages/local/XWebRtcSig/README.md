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
