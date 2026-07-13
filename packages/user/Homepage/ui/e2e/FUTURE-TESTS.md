# Chat & Realtime — future test backlog

Tests we want eventually but are **not** writing right now. Add to this list as
gaps are noticed during incident triage; pick from it during planned test
hardening sprints. Items marked `[regression]` correspond to bugs that have
been fixed in code but lack a dedicated guard.

## Opt-in / diagnostic specs (not default `yarn e2e`)

| Spec                                    | How to run                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `chat-dm-sidebar-click-debug.spec.ts`   | `yarn e2e:dm-click-debug` (or `PSIBASE_E2E_DM_CLICK_DEBUG=1` / `PSIBASE_E2E_DM_CLICK_SCENARIO=…`) |
| `diag-auth-shell.spec.ts`               | `PSIBASE_E2E_DIAG_AUTH=1 yarn e2e e2e/tests/diag-auth-shell.spec.ts`                              |
| `chat-group-three-party-random.spec.ts` | `yarn e2e:random-churn` / `PSIBASE_E2E_RANDOM_CHURN_RUNS=2`                                       |

DM sidebar helpers scope clicks to the **Direct Messages** panel so group row
aria-labels (`alice, bob`) are not mistaken for DM rows.

## P2 gaps (webrtc-code-review.md) — landed vs remaining

| Item                                                | Status                                                                                                                     |
| --------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| 13 Non-mocked L3→L4 opaque bytes                    | **Landed** — `transport/stack-opaque-bytes.integration.test.ts`                                                            |
| 13 ICE/DC fail → recover → L4 flush                 | **Landed** (stack, mocked PC) — `pc_failed` / DC `transportLost` → usable → flush                                          |
| 14 Token expiry mid-WS                              | **Partial** — RealtimeClient null-token reconnect + error-frame units; no mid-session bearer revalidation in XWebRtcSig    |
| 14 Duplicate `clientMsgId`                          | **Partial** — store dedupe + stack double-inbound (L4 notifies twice; store owns dedupe)                                   |
| 14 Partial group ACK                                | **Landed** (L4 unit) — one ACK → partial counts; second → DELIVERED; offline peer stays partial                            |
| 14 `transportLost`                                  | **Landed** (stack) — recover→usable→flush; queue-during-recover                                                            |
| 14 Reconnect-during-in-flight                       | **Landed** (stack) — welcome mid-ACK; ≤1 re-flush of same `clientMsgId`                                                    |
| 15 Shrink e2e god-flush                             | **Partial** — `chat-dm-l4-flush-strict.spec.ts`; `PSIBASE_E2E_STRICT_L4_FLUSH=1` fails remesh escalation                   |
| 16 Meet peer negotiation/`ontrack`                  | Remaining                                                                                                                  |
| 16 Decline/timeout Meet e2e                         | **Landed** — `meet-dm-decline-timeout.spec.ts`                                                                             |
| 16 Meet factory / SharedMeetPeer ensure fail        | **Partial** — factory hard-fail + SharedMeetPeer ensure-reject / peer-missing units                                        |
| 16 Outgoing DM Connected vs delayed sessionSnapshot | **Landed** — `participantJoined` promotes local roster (`promoteAvCallParticipantToJoined`); clears 20s ring-timeout flake |

### Concrete next specs (prefer unit/stack over heavy e2e)

1. **True mid-session bearer expiry** — needs XWebRtcSig revalidation (not implemented); client null-token + `transportLost` cover reconnect today.
2. **Wire e2e for duplicate `clientMsgId`** — assert single UI row after double delivery.
3. **FakePeerConnection through full stack** — real ICE fail path without mock peer.
4. **Meet `ontrack` / negotiation units** — SharedMeetPeer media path.

## End-to-end (Playwright, `e2e/tests/…`)

### Realtime + WebRTC

- `chat-dm-pending-flush-multiple-messages.spec.ts` — alice sends N (≥3)
  messages while bob is offline; verify all arrive in order on rejoin and the
  pending badge clears for every message.
- `chat-dm-rejoin-active-session.spec.ts` — bob is mid-conversation, then
  refreshes; verify the WebRTC session is re-established (no UI sticking on
  "Reconnecting…") and any in-flight outbound from alice is delivered.
- `chat-group-mesh-rejoin.spec.ts` — 3 participants in a group; one drops and
  returns; mesh peers tear down and rebuild correctly; verify queued group
  messages flow on rejoin.
- `chat-dm-second-tab.spec.ts` — bob opens chat in two tabs simultaneously;
  verify only one peer connection per session is active, no duplicate
  inbound messages, and tab-close cleanup is correct.
- `chat-presence-flap.spec.ts` — simulate a 1–2 s WS drop on bob; verify
  alice does **not** see a reconnect storm and any in-flight DM survives.
- `chat-dm-history-sync-on-rejoin.spec.ts` — alice has many historical
  messages; bob returns; full history syncs over the data channel and
  matches alice's view.
- `chat-dm-renavigation.spec.ts` — bob navigates chat ↔ home ↔ chat
  repeatedly during an active DM; verify the peer connection is rebuilt
  cleanly each time and no signals are lost.
- `chat-dm-signaling-arrival-before-shell.spec.ts` `[regression]` — force
  alice's offer to land on bob's WS _before_ bob's chat shell mounts (the
  exact race we just fixed). Assert it is buffered server-side and
  delivered atomically on bob's `joinSession`.
- `chat-3-party-presence.spec.ts` — alice/bob/carol online; carol opens
  and closes a session; verify both peers see correct
  `participantJoined`/`presence` deltas without orphan rows.

### Identity / accounts

- `chat-account-rotation.spec.ts` — bob signs out and back in with a
  different account in the same browser context; verify Chat reflects
  the new identity and prior state is gone.

## Service / Rust unit tests (`psitest`)

### `XWebRtcSig` signaling

- `fanout_signal_to_peer_returns_empty_when_peer_not_joined` `[regression]`
  — unit test for the fix: with no `sig_join_row`, the function must not
  fall back to `live_sockets_for_user`.
- `handle_signal_buffers_when_peer_not_joined` — verify the signal lands
  in `enqueue_pending_signal` and is redelivered by the next
  `handle_join_session`.
- `handle_join_session_flushes_pending_signals_in_order` — multiple
  buffered signals are delivered FIFO (offer before candidates).
- `session_invite_redelivered_on_duplicate_join` — calling `joinSession`
  twice for the same `(session_id, account)` re-emits an invite to the
  caller (recovery path).
- `two_concurrent_socket_sessions_for_same_user` — bob in two tabs;
  closing one socket leaves the other registered and reachable.

### `XWebRtcSig` socket lifecycle

- `handle_socket_cleanup_does_not_leak_zombie_rows` `[regression]` — peer
  socket already dead when `send_frame` is called; cleanup still removes
  `SocketSessionTable` / `UserSessionTable` / `SigSessionJoinTable`
  entries (this was the original cause of the WS reconnect storm).
- `rapid_socket_close_then_reconnect` — repeated close+open for the same
  user; final state matches what serial connects would produce.

### `Chat`

- `webrtcSessionEvent_records_lifecycle_correctly` — replace the dead
  `flush_pending_session_events` path with a deferred non-subjective
  flush, then test that participant-joined / participant-left / session-
  ended events are recorded with correct ordering.

## Frontend unit tests (Vitest)

- `chat-data-session-orchestrator.start_installs_handlers_eagerly`
  `[regression]` — verify `start()` causes `registerHandlers` to be
  called immediately and not lazily on first `ensureDmChatDataSession`.
- `chat-data-session-orchestrator.onSignal_unknown_session_does_not_throw`
  — receiving a `signal` for a session we don't have a run for must log
  and return; no exception, no orchestrator state change.
- `chat-data-session-orchestrator.participantJoined_resends_offer_when_initiator`
  — after the planned cleanup of `!alreadyNegotiating`, verify alice
  always nudges `resendOffer()` when the joiner is her DM peer.
- `realtime-client.frames_before_handlers_logged_loudly` — RealtimeClient
  must warn (not silently drop) when a `signal` / `participantJoined`
  arrives without a registered handler. Optional: buffer-and-replay.
- `realtime-client.welcomeCount_distinguishes_first_vs_reconnect` — sanity
  check on the existing `isReconnectWelcome()` helper.
- `dm-history-sync.shouldPushDmHistoryOnConnect_predicate` — table-driven
  test for the boolean logic.

## Manual / smoke (track but don't automate yet)

- Network partition for >60 s, then reconnect; verify recovery without
  reload.
- Cross-browser: Firefox, Safari, mobile Safari WebRTC interop.
- TURN-only path (block direct + STUN); ICE relay must succeed.
- Multi-region peers (≥150 ms RTT); verify timing budgets and that the
  first message still lands inside the 90 s assertion window.

## How to use this list

When picking up a task:

1. Move the line into the active sprint plan (or a TODO comment near the
   relevant code) with an issue link.
2. After the test lands, delete it from this file and reference it in
   `e2e/README.md` if the test exercises a non-obvious path.
3. Tests labeled `[regression]` should be prioritized whenever the
   matching code path is touched.
