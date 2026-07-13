# x-wrtcsig

Node-local subjective websocket service for WebRTC signaling, presence, and ICE
relay (architecture §5–§6). M1: `/ws` auth, welcome, presence. M3: `chat-data`
session join/signal routing validated against objective Chat `authorizeSessionJoin`,
with `webrtcSessionEvent` lifecycle wire-back. Chat message bodies are not sent on
this websocket.

## M4 manual review gate (ChatABC)

Automated coverage for group mesh signaling lives in `tests/python/test_xwebrtcsig.py`
(T-023/T-029) and Chat/XWebRtcSig service tests. There is no automated 3-browser harness;
before M4 sign-off, run the manual scenarios in `.agent-team/milestones.md` §M4 User review
with three users (A, B, C) in group Space **ChatABC**:

1. A and B online: exchange messages; C sees nothing yet.
2. C joins online: C receives history from B including messages A sent while offline.
3. All three online: send from each; confirm order by send time despite out-of-order delivery.
4. A offline; B and C chat; A returns and catches up.
5. Send while no peer path exists; confirm pending state; confirm delivery when a peer returns.

Optional devtools check: websocket frames must not carry chat message bodies (`chatMessage` /
`say` rejected; see `test_client_ready_ping_no_chat_frames`).

Service account: `x-wrtcsig` (hyphens are valid in `AccountNumber`; max length is 10, so
`x-webrtcsig` does not fit). Subprotocol target: `psibase.realtime.v1`.
