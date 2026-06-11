# WebRTC / chat-data debugging log

Living document for group mesh, DM signaling, and **eventual delivery** on branch `mm/webrtc-refactor`. Update this when we learn something that changes diagnosis or fix strategy.

## Goal

**Primary gate (6 specs, 1 worker):** `yarn e2e:delivery-gate` in `packages/user/Homepage/ui`

| Spec | Role |
|------|------|
| `chat-dm-send-before-peer-join` | DM before peer opens thread / DC |
| `chat-dm-pending-flush-on-rejoin` | Queued DM after bob left and rejoined |
| `chat-group-offline-member-catchup` ×2 | Offline member + nav variants |
| `chat-three-party-online-offline-flow` | Scripted online/offline (H18 leave-Chat workaround) |
| `chat-three-party-pending-delivery-matrix` | DM+group pending, in-chat thread switch, pairwise flush |

**Latest full gate:** **4/6 pass** (`/tmp/e2e-delivery-gate-run11.log`, ~24m). **Still red:** `chat-dm-pending-flush-on-rejoin`, `chat-three-party-pending-delivery-matrix`.

**Isolated matrix (clean port):** fails at `waitForDmDataChannelReady` (240s) after in-chat thread switch — alice `welcomeGeneration` 3→4 invalidates join while DM pending flush still blocked (`data channel not ready`).

Earlier mesh work (group roundtrip / offline) is **green**; see [Tests](#tests).

Primary historical spec: `e2e/tests/chat-group-three-party.spec.ts`

---

## Hypotheses (chronological)

| # | Hypothesis | Status | Notes |
|---|------------|--------|-------|
| H1 | WS subdomain typo (`x-webrtc-sig` vs `x-webrtcsig`) broke signaling | **Fixed** | DM e2e recovered |
| H2 | `hasJoined` stale after WS reconnect; server has us in `pendingParticipants` but client skips `joinSession` | **Partial fix** | Clear on snapshot + `joinedWelcomeGeneration` |
| H3 | Headless Chromium can't do WebRTC ICE | **Ruled out** | xvfb `--headed` run failed identically to headless |
| H4 | Initiator deadlock: both sides create peers with `isInitiator: false` → no SDP offers | **Confirmed** | E2E logs showed zero `signal → offer` until bob path fixed |
| H5 | Peers created before `self` in roster → wrong initiator, then reused | **Partial fix** | Gate `syncMeshPeers` on `sessionRoster.has(self)` |
| H6 | Batch `sessionSnapshot` assigns same `joinedAt` to all joiners | **Partial fix** | Index stagger insufficient alone |
| H7 | Optimistic `self` roster + `pendingParticipants` wipes `self` before server confirms join | **Investigating → fix below** | Pending loop deletes roster entry; optimistic entry uses wrong `joinedAt` vs incremental snapshots |
| H8 | `rosterUpdated` → `beginSignaling` on every snapshot causes reuse storm (~2M log lines) | **Confirmed** | Fix: only reconcile when `newJoiners.length > 0` |
| H9 | Offline catch-up: `returningMember` gets pending flush only, not history sync → fresh browser rejoin misses messages | **Fixed** | Push history for `returningMember` too |
| H10 | Full-roster snapshot assigns `joinedAt` in server array order → self listed first gets lowest rank, initiator deadlock | **Fixed** | Process `self` last in newcomer batch; monotonic helper everywhere |
| H11 | Pending flush `ensure` while `signaling` re-enters `beginSignaling` → ~666k log storm | **Fixed** | Ignore `ensure` in signaling; skip ensure dispatch when session active |
| H12 | Out-of-order `sessionSnapshot` (epoch 2 after epoch 3) regresses roster → alice demoted pending, mesh stuck | **Fixed** | Track `sessionSnapshotEpoch`; ignore stale frames unless H17 departure exception |
| H13 | Roundtrip e2e used 9-char account names; Accounts create requires ≥10 → Create never reaches "Secure your" | **Fixed** | `rtalicegc0` etc.; guard in `auth-ui.ts` |
| H14 | Per-client `ensureSelfInSessionRoster` made each peer think it joined first → symmetric initiator deadlock | **Reverted** | Gate mesh until `self` ∈ snapshot; hybrid self-last only for multi-newcomer batches |
| H15 | Duplicate `sessionInvite` while `ready` re-ran `beginSignaling` (app re-entry storm) | **Fixed** | Ignore duplicate invite when mesh already up |
| H16 | `debugPeerId` keyed only by `sessionId:self` — group mesh overwrote registry; e2e `waitForGroupMeshReady` blind | **Fixed** | Include `peerAccount` in debug id |
| H17 | Legitimate departure snapshots use lower epoch than last applied; H12 ignored them → roster/DC stuck after offline | **Fixed** | `transportLostAt` + apply stale epoch when pending matches recent `transportLost` |
| H18 | DM then group on same clients without leaving Chat → `flush pending: group mesh peer not ready` (welcomeGeneration drift) | **Workaround in e2e** | `leaveChatToHome` both parties before `createGroupChat`; product fix TBD |
| H19 | First DM send wedged: `participantJoined`/`sessionSnapshot` re-ran `beginSignaling`; roster flipped initiator mid-offer → `rebuild for initiator role` closed PC (`data channel close`, endless `flush pending`) | **Fixed** | FSM: DM `participantJoined`/`rosterUpdated` during signaling → `resendOffer` only; reconciler: ignore initiator drift while `negotiationInProgress` |
| H20 | WS reconnect called `reconcileAfterReconnect` → `transportTornDown` on **every** open run; killed working DM DC; duplicate remote offers → duplicate answers; `sessionInvite` during signaling re-ran full `beginSignaling` | **Fixed** | Reconcile skips runs with live DC (re-`joinSession` only); drop duplicate offers at `stable`; DM `sessionInvite` during signaling → `resendOffer` |
| H21 | App churn / WS welcome refresh: duplicate `participantJoined` while group `ready` ran `disposeAllPeers` → working mesh legs dropped (`data channel error`, `transportLost`) | **Fixed** | Group: incremental `participantJoined` when other mesh legs live; `rosterUpdated` during signaling → `resendOffer`; welcome refresh re-`joinSession` without clearing mesh when DCs open (H18 product path) |
| H22 | Mixed `sessionId` on group mesh legs: `syncMeshPeers` skipped `dataChannelReady` peers so one leg stayed on old `wrtc:*` while recovery used a new session; FSM `beginSignaling` did not update `state.sessionId` in `ready`/`signaling` | **Fixed** | Tear down peers whose `sessionId` ≠ active session before mesh sync; FSM adopts new session id (+ `disposeAllPeers` on change); ignore duplicate `participantJoined` when peer already ready |
| H23 | After `connectionState=failed`, `syncMeshPeers` reused the dead PC (`ensureConnection: reuse`, `dataChannelReady: false`) so recovery and churn e2e wedged | **Fixed** | `ChatDataWebRtcPeer.transportUnhealthy`; `syncMeshPeers` tears down unhealthy legs before `ensureConnection` |
| H24 | WS `welcomeGeneration` drift with **no** open group DC left stale `meshPeers`; pending flush logged thousands of `group mesh peer not ready` and wedged the tab | **Fixed** | `beginSignalingGroup` tears down all mesh legs before re-`joinSession`; debounced pending flush + deduped skip logs; throttled `ensure` nudges (`lastMeshNudgeMs`) |
| H25 | Pending flush called `ensureGroup` while run was `ready` but mesh incomplete; `ensureChatDataSession` returned early so dead legs never got `syncMeshPeers` | **Fixed** | Incomplete group mesh → throttled `beginSignalingGroup` from `ensureChatDataSession` |
| H26 | Group mesh `ensureConnection: reuse` with `dataChannelReady: false` — roster initiator drift ignored for group; polite legs waited forever | **Fixed** | Rebuild group peer on initiator mismatch; no reuse without open DC (initiator may resend offer) |
| H27 | Re-clicking the already-selected group row while the tab is wedged looked like a product hang (e2e shortcut); healthy UI should no-op | **Fixed** | `selectConversation` returns immediately when `id` is already selected |
| H28 | Background DM ICE from pending flush while a group is focused wedged the main thread during back-to-back `homeNav` churn | **Fixed** (layering **TODO**) | Release idle DM transport on selection change; throttle background `ensureDm` (`shouldThrottleBackgroundDmEnsure`). **Come back:** app adapter still passes `getSelectedConversationId` into flush — move to orchestrator `setFocusedSpace` (see Open work #2). |
| H29 | Optimistic `hasJoined` on `joinSession` TX while server still has self in `pendingParticipants` → signals rejected, client thinks joined | **Fixed** | `hasJoined` only from `sessionSnapshot` / `selfJoinedNow`; `mustRequestJoin` until server confirms + welcome gen match |
| H30 | Outbound SDP/ICE sent before joined socket → server drops or peer not ready | **Fixed** | Client defers in `webrtc-signaling-client.ts`; `flushDeferredSignals` on self ∈ `joinedParticipants` |
| H31 | Background tab joined on server but active socket never got `sessionSnapshot` (fanout only to joined sockets) | **Fixed** | `fanout_session_snapshot` also delivers to **pending** participants' live sockets (`signaling.rs`) |
| H32 | DM `sessionResolved` with peer offline never joined x-webrtcsig → no flush path when peer returns | **Fixed** | FSM: DM `sessionResolved` → `beginSignaling` even if `!anyPeerOnline` |
| H33 | `beginSignalingDm` opened PC while peer offline; stale offers after roster rejoin | **Fixed** | Early `joinSession`, **skip `startDmPeer` until peer presence online** |
| H34 | DM initiator rebuild after remote rejoin → offer/answer glare, matrix pairwise wedge | **Fixed** | Reconciler: **ignore initiator drift for DM** (lock role at peer creation); group still rebuilds |
| H35 | `selfJoinedNow` re-ran full `beginSignaling` while DM peer already live | **Fixed** | Realtime handler skips redundant begin when DM peer exists |
| H36 | Welcome reconnect (`welcomeGeneration` bump) mid multi-session tab: join invalidated, DM DC never recovers during matrix thread switch | **Investigating** | `invalidateJoinStateForWelcomeReconnect` + re-`joinSession`; matrix still times out on background DM leg after gen 4 |

---

## Timing and backpressure (infra vs app)

**Short answer:** Yes — the meaningful timers and throttle gates live in the **chat-data / WebRTC orchestration layer**, not in Chat UI components (pages, sidebar, composer). A future app should call a small surface (`ensureChatDataSession`, send/enqueue, select conversation) and **not** import timing constants or `lastMeshNudgeMs` semantics.

**Layer map:**

| Layer | What it owns | Timing today? |
|-------|----------------|---------------|
| **UI** (`chat-page`, `conversation-list`, `use-conversation-selection`) | Clicks, selection, compose | **No** mesh/signaling delays (H27 is an instant no-op, not a timer). |
| **App adapter** (`use-chat-socket`, pending store, flush scheduling) | Wires realtime + selection + pending queue into orchestrators | **Minimal:** debounced flush scheduling and `setTimeout(0)` yield points; H28 idle-release **effect** (immediate, not a delay). |
| **Infra** (`ChatDataSessionOrchestrator`, group/DM orchestrators, `ChatDataWebRtcPeer`, `transport-recovery`, `executePendingFlushPlan`, `pending-delivery-coalesce`) | Sessions, mesh legs, ICE, pending delivery plan | **Yes** — this is where backoff, nudges, and coalescing belong. |

**E2e harness** (`e2e/lib/churn-timing.ts`, Playwright step budgets) is intentionally **out of scope** here; mesh pacing there is test-only, not product UI.

**Design goal for the next app:** Infra exposes **policy + readiness** (“focused space”, “delivery lane ready”, “suspended for navigation”). Apps pass **intent** (selected conversation, outbound message); infra decides when to ICE, flush, or tear down. Time-based gates below are acceptable **inside infra** as long as apps do not duplicate or configure them.

### Delay inventory

| Layer | Location | Mechanism | Why it exists | App must understand? | Verdict |
|-------|----------|-----------|---------------|----------------------|---------|
| Infra | `use-chat-socket.ts` → `schedulePendingFlush` | `setTimeout(…, 80)` debounce | Coalesce many effect-driven flush plans into one tick (H24). | **Borderline** — lives in adapter today; should move behind orchestrator `scheduleFlush()` so apps only call `enqueuePending` / `notifyPendingChanged`. | **Reasonable delay** if hidden behind infra API. Optional later: event-driven flush only (no fixed ms). |
| Infra | `use-chat-socket.ts` / `use-chat-orchestrator.ts` | `setTimeout(…, 0)` before flush | Yield so roster/snapshot updates apply before planning send. | No — apps should not schedule flushes manually. | **Reasonable** (microtask yield, not backpressure). |
| Infra | `pending-delivery-coalesce.ts` | 5s dedupe on skip **logs** | Prevent console sync flood from hot skip path (H24). | No. | **Reasonable**; better: rate-limited debug channel, keep dedupe in infra. |
| Infra | `chat-data-session-orchestrator.ts` → `ensureChatDataSession` | `lastMeshNudgeMs` ≥ **2s** between nudges | Cap `beginSignalingGroup` / `ensure` while `signaling`/`ready` (H24/H25). | No. | **Reasonable** until infra exposes per-leg readiness (below). |
| Infra | `chat-data-webrtc-peer.ts` → `resendOffer()` | `lastResendOfferMs` ≥ **2s** | Limit offer retransmit / `restartIce` storm (H26). | No. | **Reasonable**; optional later: await in-flight `createOffer` / server ack instead of wall clock. |
| Infra | `chat-data-idle-release.ts` → `shouldThrottleBackgroundDmEnsure` | **3s** gate on background `ensureDm` | H28: background DM ICE while group focused must not starve the main thread. | **Leak today:** flush executor needs `getSelectedConversationId` from app. | **Reasonable delay** if orchestrator owns **focused space** (`setFocusedSpace(id)`); app only sets selection, infra applies throttle. |
| Infra | `use-chat-socket.ts` → `releaseIdleChatDataForSelection` | `useEffect` (no timer) | H28: tear down idle DM transport when selection changes. | App triggers via selection only — **good pattern**. | **Keep**; promote to orchestrator `onFocusedSpaceChanged(id)` so adapter is one line. |
| Infra | `chat-data-session-orchestrator.ts` → `reconcileAfterReconnect` | **50ms** debounce | Batch WS welcome/reconnect reconciliation. | No. | **Reasonable**; optional: `await realtime.whenWelcomeProcessed(gen)`. |
| Infra | `use-pending-delivery.ts` → send paths | **5s** clears `inFlight` keys | Dedup rapid resends before ack. | No. | **Reasonable** as safety timeout; **prefer promise:** clear on `messageAck` (F7) when ack path is reliable. |
| Infra | `transport-recovery.ts` | Exponential **500ms–30s** | Retry after `transportLost` / failed PC. | No. | **Reasonable** backoff; optional: resolve early on `dataChannelOpen` event instead of blind retry tick. |
| App adapter | `use-objective-spaces.ts` | **750ms** debounce on presence → spaces reload | Avoid reloading objective list on every presence tick. | Only if app uses that hook; not WebRTC core. | **Reasonable** for data loading; unrelated to mesh. |
| UI | — | — | — | — | **No product delays** in thread/list/composer for WebRTC. |

`lastMeshNudgeMs` on each run is reused for both the **2s** orchestrator nudge (H24/H25) and the **3s** background-DM flush gate (H28) — infra-internal only; apps must not read or set it.

### When infra should grow promises (apps stay dumb)

These are **not** urgent replacements for the delays above; they are the direction so the next app never copies timer logic:

| Infra capability | Replaces / reduces | App surface |
|------------------|-------------------|-------------|
| `setFocusedSpace(spaceId \| null)` + internal idle release / background ensure policy | H28 throttle + selection effect in `use-chat-socket` | App: `onSelectConversation(id)` only. |
| `whenGroupMeshReady(spaceId, recipients): Promise<void>` | 2s mesh nudges; pending-flush “peer not ready” spin | App: `await delivery.sendWhenReady(...)` or orchestrator auto-flush on resolve. |
| `whenSignalingReady(): Promise<void>` on shared WS client | Log-and-skip `signal` while not session-ready; ad-hoc retries | App: no WS lifecycle knowledge. |
| `whenDataChannelOpen(spaceId, peer): Promise<void>` per leg | `resendOffer` wall clock; mesh-not-ready skip noise | FSM awaits leg promise before `ready`. |
| `suspend()` / `resume()` on route leave/enter Chat shell | Main-thread wedge during `homeNav` churn (product + e2e) | Router or shell calls infra once; not per-feature timers in UI. |
| `onMessageAck(clientMsgId, recipient)` clearing in-flight | 5s send dedupe timer | App: send and forget; infra retries policy-internal. |

**Fine to keep as time delays (inside infra only):** transport recovery backoff, reconnect reconcile debounce (50ms), flush debounce (80ms) if not exposed to apps, skip-log dedupe, `resendOffer` 2s until negotiation promises exist.

**Not fine long-term:** any requirement that the app pass selection into `executePendingFlushPlan`, read run phase, or schedule its own ICE nudges — that knowledge should stay in orchestrator policy.

### Follow-up: H28 app→infra leak (come back)

H28 mitigated the wedge but left a **layering leak** at the app adapter boundary:

| Today (leak) | Target |
|--------------|--------|
| `use-chat-socket` passes `getSelectedConversationId` into `executePendingFlushPlan` so `shouldThrottleBackgroundDmEnsure` knows a group is focused | `ChatDataSessionOrchestrator.setFocusedSpace(spaceId \| null)` (or equivalent) updated when the app selects a conversation |
| `releaseIdleChatDataForSelection` in `use-chat-socket` walks runs and calls `releaseIdleTransport` | Orchestrator handles focus change internally (same hook as above) |

Until that refactor, **new apps must not copy** the throttle helper or wire selection into the flush executor — treat this as temporary Chat-app plumbing only.

---

## What the test suite was missing (vs your manual runs)

| Manual behavior | Why old e2e passed | Coverage now |
|-----------------|-------------------|--------------|
| Send DM before peer opens thread / DC ready | Tests waited for both peers **online** (presence), not **data channel** | `chat-dm-send-before-peer-join`, `waitForDmDataChannelReady` |
| WS flap / `welcome` reconnect with 2–3 DMs + group still joined | No sim or e2e for `reconcileAfterReconnect` | H20 reconcile fix + `chat-multi-conversation-churn` |
| Duplicate `sessionInvite` / second remote **offer** after answer | Not in peer unit tests | `ChatDataWebRtcPeer stale-offer guard` |
| Switch DM → another DM → group without leaving Chat | H18 e2e used `leaveChatToHome` workaround only | `chat-multi-conversation-churn` (no leave) |
| `socketCount` > 1, multiple `joinSession` on one tab | Not modeled | SessionSim + future stress (opt-in random churn) |

**Default `yarn e2e` still does not equal “open 3 tabs and click around for 5 minutes.”** Run `chat-multi-conversation-churn` and `chat-dm-send-before-peer-join` before manual QA; add opt-in random churn for PR validation.

---

## Key findings

### Initiator deadlock (H4) — 2025-06-01

**Symptom:** E2E logs show `ensureConnection: create … isInitiator: false` on **every** mesh leg; `dataChannelReady` never true; no `signal → offer` frames.

**Cause:** F2 rule (`shouldInitiateOffer`) requires the late joiner's `joinedAt` to be strictly greater than the peer's. Peers were created when roster was incomplete, or `joinedAt` ordering was wrong, so both sides thought the other should initiate.

**Evidence:**

```
[bob] ensureConnection: create … remote: e2ealicegc, isInitiator: true   ← fixed after gating
[carol] ensureConnection: create … remote: daviddavid, isInitiator: false  ← still wrong
[carol] ensureConnection: create … remote: e2ealicegc, isInitiator: false
```

After bob fix, bob↔alice offers/answers flow. Carol legs remain dead.

### Headed vs headless (H3) — 2025-06-01

- Raw `--headed`: no X server in CI/devcontainer
- `xvfb-run -a --headed`: runs, **same failure** as headless (10m timeout, carol initiator false)

Conclusion: not a headless-only WebRTC issue.

### Roster `joinedAt` ordering (H6/H7) — 2025-06-01

`mergeRosterIntoRun` used `now + index` within a snapshot batch. When joiners appear **incrementally** (alice already in roster from `sessionInvite`, bob from earlier snapshot, carol newly added), carol gets `now + 0` while bob may have `now + 1` from a **previous** snapshot → **carol appears to have joined earlier than bob** → initiator deadlock on bob↔carol.

Optimistic self entry on `joinSession` (before server confirms) interacts badly with `pendingParticipants` clearing roster entries.

### WS reconnect / pending (H2) — 2025-06-01

Server log pattern:

```
sessionSnapshot: joinedParticipants: [alice, carol], pendingParticipants: [bob]
transportLost for bob
```

Client `hasJoined: true` + `mustJoin: false` while server rejects signals until re-join. Addressed with snapshot self-check and welcome generation tracking.

---

## Fixes applied

| Date | Change | Files | E2E after |
|------|--------|-------|-----------|
| 2025-06-01 | WS URL `x-webrtcsig` | `realtime-client.ts` | DM pass |
| 2025-06-01 | Handler registration via provider `registerHandlers()` | orchestrator, `use-chat-socket.ts` | DM pass |
| 2025-06-01 | Clear `hasJoined` when self ∉ `joinedParticipants` | `chat-data-realtime-handlers.ts` | — |
| 2025-06-01 | `joinedWelcomeGeneration` on reconnect | `realtime-client.ts`, group orchestrator, run actor | — |
| 2025-06-01 | Gate mesh until `self` and remote in roster | `chat-data-group-orchestrator.ts` | bob↔alice signals |
| 2025-06-01 | Rebuild peer when initiator role changes (stalled DC) | `chat-data-connection-reconciler.ts` | — |
| 2025-06-01 | Sim idempotent duplicate `joinSession` | `chat-data-session-sim.ts` | sim pass |
| 2025-06-01 | Index stagger in `mergeRosterIntoRun` | `chat-data-realtime-handlers.ts` | insufficient |
| 2025-06-01 | Optimistic self `joinedAt = max+1` on join | `chat-data-group-orchestrator.ts` | insufficient (carol still false) |
| 2025-06-01 | **Pending:** monotonic `joinedAt` for new roster entries; remove optimistic self; `rosterUpdated` only if `newJoiners.length > 0` | see below | TBD |
| 2025-06-01 | Monotonic `joinedAt` in `mergeRosterIntoRun` (`max+1` per new joiner) | `chat-data-realtime-handlers.ts` | **three-party PASS** |
| 2025-06-01 | Remove optimistic self roster on `joinSession`; mesh waits for server snapshot | `chat-data-group-orchestrator.ts` | **three-party PASS** |
| 2025-06-01 | `rosterUpdated` → `beginSignaling` only when `newJoiners.length > 0` | `chat-data-run-state-machine.ts` | log 687 vs 2M lines |
| 2025-06-01 | Re-join when snapshot demotes self to pending (`beginSignaling` after clear) | `chat-data-realtime-handlers.ts` | — |
| 2025-06-01 | Push group history on `returningMember` DC open (H9) | `catch-up-policy.ts` | offline PASS |
| 2025-06-01 | Self-last newcomer ordering in `mergeRosterIntoRun`; monotonic roster helper (H10) | `chat-data-realtime-handlers.ts` | offline PASS |
| 2025-06-01 | Ignore `ensure` while signaling; skip ensure dispatch when session active (H11) | `chat-data-run-state-machine.ts`, `chat-data-session-orchestrator.ts` | log 806 vs 1.6M |
| 2025-06-01 | Ignore stale `sessionSnapshot.epoch` (H12) | `chat-data-realtime-handlers.ts`, `chat-data-session-types.ts` | offline PASS |
| 2026-06-04 | Join gate: `hasJoined` from snapshot only; `mustRequestJoin` + welcome gen (H29) | `chat-data-realtime-handlers.ts`, DM/group orchestrators, `chat-data-run-actor.ts` | — |
| 2026-06-04 | Deferred outbound signals + flush on join (H30) | `webrtc-signaling-client.ts`, `chat-data-realtime-handlers.ts` | — |
| 2026-06-04 | Server snapshot fanout to pending auth sockets (H31) | `XWebRtcSig/service/src/signaling.rs` | matrix logs: alice gets snapshot on background DM |
| 2026-06-04 | DM `sessionResolved` → `beginSignaling` when peer offline (H32) | `chat-data-run-state-machine.ts` + test | vitest |
| 2026-06-04 | DM: join early, defer PC until peer online (H33) | `chat-data-dm-orchestrator.ts` | — |
| 2026-06-04 | DM initiator role drift ignored (H34) | `chat-data-connection-reconciler.ts` | reduced matrix glare |
| 2026-06-04 | Skip redundant `beginSignaling` on `selfJoinedNow` if DM peer up (H35) | `chat-data-realtime-handlers.ts` | — |
| 2026-06-04 | Welcome reconnect: invalidate join + reset snapshot epoch | `chat-data-session-orchestrator.ts`, `use-chat-socket.ts` | matrix still flaky (H36) |

Rebuild after server/client changes: **Homepage.psi** + **XWebRtcSig.psi** (`start_package_build` via ai-tools MCP, `workspace_root: /root/psibase`).

---

## Tests

| Suite | Result | Notes |
|-------|--------|-------|
| Chat vitest (`src/apps/chat/lib/`) | **295/295 pass** | 2026-06-04 |
| `yarn e2e:delivery-gate` (6 specs) | **4/6** (run11) | Red: `chat-dm-pending-flush-on-rejoin`, `chat-three-party-pending-delivery-matrix` |
| `chat-dm-send-before-peer-join` | **PASS** (gate) | `waitForDmDataChannelReady` |
| `chat-group-offline-member-catchup` ×2 | **PASS** (gate) | |
| `chat-three-party-online-offline-flow` | **PASS** (gate) | H18 `leaveChatToHome` before group |
| `chat-dm-pending-flush-on-rejoin` | **FAIL** (gate) | Bob starts DM first; alice `sessionSnapshot: no run` until `ensureDmChatDataSession`; DC timeout ~180–213s |
| `chat-three-party-pending-delivery-matrix` | **FAIL** (gate + isolated) | 240s `waitForDmDataChannelReady` at pairwise assert; welcome gen 3→4 mid test |
| `chat-dm-*` e2e (other) | pass | |
| `chat-group-three-party` | **PASS (~1.4m)** | |
| `chat-group-roundtrip-three-party` | **PASS (~1.4m)** | H13: account names must be ≥10 chars |
| `chat-group-app-churn` | **PASS ~1.4m** | 3× nav all parties + bob offline rejoin; H16+H17 |
| `chat-dm-pending-app-churn` | **PASS ~1.2m** | pending while bob away + alice 2× nav + bob fresh context |
| `chat-group-three-party-random` | manual | `PSIBASE_E2E_RANDOM_CHURN_RUNS=10`; skipped in default `yarn e2e` |
| `e2e:random-churn:decaf` | **baseline** | 1×30, seed `0xdecafbad`, strict mesh; log `/tmp/random-churn-decaf-v15.log` |
| `e2e:random-churn:diag:wedge` | **baseline** | steps 11–13, stop at 13; bob back-to-back `homeNav` |

**Infra flakes (not product):** full gate aborted with `e2e chain port 127.0.0.1:8080 is still in use after teardown` or SIGINT (129). Before re-run: `fuser -k 8080/tcp; rm -f /tmp/psibase-e2e-run.lock`.

---

## Debug commands

```bash
# Unit / sim
cd packages/user/Homepage/ui
yarn vitest run src/apps/chat/lib/

# E2E (fresh chain via global-setup)
yarn playwright test --config e2e/playwright.config.ts e2e/tests/chat-group-three-party.spec.ts

# Headed on machine without X
xvfb-run -a yarn playwright test --config e2e/playwright.config.ts --headed e2e/tests/chat-group-three-party.spec.ts

# Delivery gate (6 specs, serial worker)
yarn e2e:delivery-gate

# Isolated matrix (after killing port / lock)
fuser -k 8080/tcp 2>/dev/null; rm -f /tmp/psibase-e2e-run.lock /tmp/psibase-e2e-chain-state.json
yarn playwright test --config e2e/playwright.config.ts e2e/tests/chat-three-party-pending-delivery-matrix.spec.ts

# Build packages (ai-tools MCP, not raw make)
# start_package_build: Homepage, XWebRtcSig — workspace_root /root/psibase
```

**Log grep patterns:**

```
ensureConnection: create
isInitiator
signal → server
dataChannelReady
sessionSnapshot
pendingParticipants
beginSignaling group mesh
mustRequestJoin
welcome reconnect: invalidate join
flush pending: data channel not ready
flushDeferredSignals
ensureConnection: DM initiator role drift ignored
sessionSnapshot: no run
```

---

## Open work

1. ~~Group mesh e2e~~ all group specs **green**
2. **Delivery gate 6/6:** `chat-dm-pending-flush-on-rejoin` (bob-before-alice race / create run on invite without space run); `chat-three-party-pending-delivery-matrix` (H36 welcome reconnect + background DM DC after thread switch)
3. **H36 product:** After welcome reconnect with open multi-session tab, recover background DM transport without wedging focused group (may need transport recovery on `transportLost`, or narrower invalidate-join scope)
4. **Come back — H28 layering:** Move focused-conversation policy into orchestrator (`setFocusedSpace` / `onFocusedSpaceChanged`). Remove `getSelectedConversationId` from `PendingDeliveryExecutorDeps` and collapse `releaseIdleChatDataForSelection` in `use-chat-socket` to a single orchestrator call. See [Follow-up: H28 app→infra leak](#follow-up-h28-appinfra-leak-come-back).

---

## Very soon action (post–random-churn wedge baseline)

Baseline confirmed: `yarn e2e:random-churn:decaf` — 1×30 steps, seed `0xdecafbad`, strict mesh (bob back-to-back `homeNav` steps 12→13). Re-run after each item below.

### VS-1 — Dedupe `homeNav` suspend (e2e + optional product guard) — **done 2026-06-04**

**Problem:** `churnHomeNav` calls `__chatChurnSuspend` twice (CDP `Runtime.evaluate` fire-and-forget **and** `page.evaluate` with 5s timeout). Traces show duplicate `navigation-suspend` / `navigation-suspend-close-realtime-scheduled` (harmless today, noisy).

**Implemented:**

- E2e (`e2e/lib/chat-ui.ts`): keep **CDP** path (`Page.stopLoading` + non-awaiting `__chatChurnSuspend?.()`); **conditional** `page.evaluate` suspend only when `[churn-probe]` shows `navigationSuspended` still false after 150ms (avoids duplicate suspend when CDP succeeded).
- Optional product (`use-chat-socket.ts` → `suspendChatNavigation`): early-return when `transportBridgeRef.current?.isNavigationSuspended()` already true (bridge `suspendForNavigation` is already idempotent; avoids double `setTimeout(0)` `close()`).

**Risk:** Low. Wedge regression only if CDP path fails to run JS while renderer is wedged — mitigated by deferred `webrtcClient.close()` and `forceLeaveChatToHome`.

**Verify:** `yarn e2e:random-churn:diag:wedge`, `yarn e2e:random-churn:decaf`.

### VS-2 — Realtime on re-enter (scoped; do **not** change `homeNav` re-enter) — **done 2026-06-04**

**Problem:** `churnNoRealtime=1` on `homeNav` re-enter and `parkActorNoRealtime` keeps WS/mesh off during tight navigation — good for wedge stability, less like production where mesh may be warm before the next send.

**Implemented (e2e only; `churnHomeNav` re-enter unchanged):**

- `shouldParkActorNoRealtime()` — park after every middle step (same as VS-1; avoids signaling exhaustion from extra live WS tabs).
- `focusChurnGroupThread` — when enabling realtime for `groupSend` after `homeNav` re-enter, `preparePageForNavigation` + `hardNavigate` to the group URL without `churnNoRealtime` (VS-1 path). `urlMatchesAssignTarget` / `urlMatchesTarget` compare `churnNoRealtime` so strip navigations complete.
- `ensureGroupThreadRealtime()` remains in `chat-ui.ts` for targeted use.

**Verify:** `yarn e2e:random-churn:decaf` ×2; `yarn e2e:random-churn:diag:wedge` optional.

---

## Session notes

_Add dated entries below as we learn more._

### 2025-06-01 — Carol initiator root cause narrowed

Incremental snapshots + optimistic self roster produce **carol `joinedAt` ≤ bob `joinedAt`**, so F2 assigns `isInitiator: false` on both sides of carol's legs. Fix direction: assign new roster entries `max(existing joinedAt) + 1`, only mesh after server snapshot includes `self` in `joinedParticipants`, suppress noop `rosterUpdated` reconciliation.

### 2025-06-01 — Fix confirmed: `chat-group-three-party` PASS

After monotonic roster + server-confirmed self gating:

- Carol logs: `isInitiator: true` for both alice and bob legs
- Test passed in **1.4m** (was 10m timeout)
- Diagnostic log **687 lines** (was ~2.4M from beginSignaling storm)

Remaining: roundtrip + offline catch-up specs (not yet re-run isolated post-fix).

### 2025-06-01 — H9: returningMember catch-up gap

When alice closes browser and rejoins fresh, bob/carol still have `peerOnlineAtSessionStart[alice]=true` and `hadOpenDataChannel[alice]=true`. Catch-up policy classifies this as `returningMember` → **pending flush only**, no history sync. Alice's empty store never receives `baseline-mesh-ok` or `while-alice-was-away`. Fix: `shouldPushHistoryOnConnect` also true for `returningMember` (README M4 #4: "bring A back; confirm A catches up").

### 2025-06-01 — H10: full-roster snapshot join order

Carol opening an existing group gets `sessionSnapshot merged { newJoiners: [alice,bob,carol] }` in one frame. Monotonic `joinedAt` followed server `joinedParticipants` order; when carol (`self`) was listed first she got the **lowest** rank → `isInitiator: false` on all legs. Three-party passed because joiners arrived incrementally (carol alone in a later snapshot). Fix: assign newcomers with **`self` always last** in the batch; use `ensureMonotonicRosterEntry` in `participantJoined` / `sessionInvite` too.

### 2025-06-01 — H11/H12 + ensure spam: offline catch-up PASS

After H11 (`ensure` no-op while signaling/ready) + H12 (epoch gate) + H10 (self-last roster):

- `chat-group-offline-member-catchup` both tests **PASS** (~1.4–1.7m)
- Diagnostic log **806 lines** (was 1.6M)
- `chat-group-three-party` still **PASS** (~1.4m)
- Roundtrip spec still hits auth setup flake (unrelated to mesh)

### 2025-06-01 — H11: ensure → beginSignaling storm during flush

While stuck in `signaling` with a dead mesh leg, pending flush calls `ensureChatDataSession` → `ensure` event → `beginSignaling` on every tick (~666k lines). Fix: ignore `ensure` when already in `signaling`, and skip dispatching `ensure` from `ensureChatDataSession` when phase is `signaling`/`ready`.

### 2025-06-01 — H12: out-of-order sessionSnapshot epoch

Carol received epoch **3** (all joined) then epoch **2** (alice pending) — stale frame wiped alice from roster and emitted `transportLost`. Mesh never reached `dataChannelReady`. Fix: `run.sessionSnapshotEpoch` + ignore `frame.epoch <= last`.

### 2026-06-04 — Eventual delivery gate (H29–H35)

**Scope:** Chat eventual delivery on `mm/webrtc-refactor` — client join/signal gating, server snapshot fanout, DM defer-until-online, DM initiator lock.

**Client (`packages/user/Homepage/ui/src/apps/chat/lib/`):**

- `hasJoined` set only when `sessionSnapshot` includes self (not when `joinSession` is sent).
- `mustRequestJoin` while `!hasJoined` or `joinedWelcomeGeneration !== welcomeGeneration`.
- Outbound signals deferred until joined; flushed on snapshot self-join.
- DM: `sessionResolved` with peer offline still triggers `beginSignaling` (join only); `startDmPeer` gated on peer presence `online`.
- DM reconciler ignores initiator drift (H34); `selfJoinedNow` skips redundant begin if peer exists (H35).

**Server (`packages/local/XWebRtcSig/service/src/signaling.rs`):**

- `fanout_session_snapshot` also targets live sockets for participants still in `pendingParticipants` auth state (background DM tab).

**Gate status:** run11 **4/6**. Matrix isolated (~5.8m): alice pending flush + new WS + `welcome reconnect: invalidate join` (gen 3→4) on both DM and group spaces; `waitForDmDataChannelReady` 240s timeout at `assertPendingDeliveredForPair`.

**Rejoin spec failure:** bob opens DM first; alice logs `sessionSnapshot: no run` before `ensureDmChatDataSession` — ordering / run creation on invite when space not yet materialized.

### 2026-06-04 — VS-1 / VS-2 random-churn wedge

See [Very soon action](#very-soon-action-postrandom-churn-wedge-baseline) — deduped `homeNav` suspend and scoped realtime on re-enter (**done**).
