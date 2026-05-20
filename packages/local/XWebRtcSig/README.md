# x-webrtcsig

Node-local subjective websocket service for WebRTC signaling, presence, and ICE
relay. This package is scaffolded from architecture §11.2; websocket `/ws` auth,
welcome frames, and presence fanout are implemented in later milestones.

Service account: `x-webrtcsig` (architecture doc `x-webrtc-sig` is not a valid
psibase `AccountNumber`; see team note in T-001). Subprotocol target:
`psibase.realtime.v1`.
