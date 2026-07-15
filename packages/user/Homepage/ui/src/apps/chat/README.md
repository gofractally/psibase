# Chat (Homepage sub-app)

Chat UI lives under Homepage at route `/chat` (Chainmail/Contacts pattern). Objective
`chat` service holds Spaces, WebRTC session metadata, and call timeline events;
`x-webrtc-sig` provides websocket presence and Meet signaling.

## M5 manual review gate #1 — Contacts DM Meet

Automated unit tests cover av-call orchestration, timeline merge, and Contacts policy
helpers. There is no automated two-browser harness; before M5 sign-off item #1, run
the manual scenario in `.agent-team/milestones.md` §M5 User review with two Contacts
users on the **same node** (architecture §7 — no cross-node `home_node` in v1):

1. Open Chat from Homepage (`homepage.<host>/chat`) as user A; pick contact B from
   **Contacts** and open the DM (ensureSpace runs in the background).
2. Start **Meet** from the DM thread; confirm B sees an incoming Meet dialog.
3. B accepts; confirm local and remote A/V in CallView for both parties.
4. Toggle mute and video; confirm indicators update for the remote party.
5. Hang up from either side; confirm call ends cleanly and a call timeline event
   (started/ended) appears in the DM thread when surfaced via objective `callEvents`.

Optional devtools: websocket `/ws` frames carry signaling only (no chat message bodies).

## M5 manual review gate #2 — Contacts group Meet (3+ participants)

Automated unit tests cover group Meet UI state, mesh orchestration, Contacts policy
for group invites, and active-session discovery for late online members. Before M5
sign-off item #2, run this manual scenario with **three Contacts users** (A, B, C) on
the **same node**:

1. As A, create a **group Space** from Contacts with B and C; open the group thread.
2. Start **Meet** from the group thread; confirm B and C (when online) see incoming
   group Meet dialogs.
3. With all three online, accept on each; confirm CallView shows **3+ participant
   tiles** with identity labels and working local/remote A/V.
4. Toggle mute and video; confirm remote indicators update per participant.
5. **Partial join:** take C offline before A starts Meet; A and B complete the call
   with A/V. Bring C online and open the group thread; confirm C receives the active
   call invite (missed while offline) and can join the in-progress mesh.
6. Hang up from any participant; confirm call ends cleanly and call timeline events
   appear in the group thread when surfaced via objective `callEvents`.

Optional devtools: websocket `/ws` carries signaling only; offline members do not
receive `sessionInvite` until their client reconnects and discovers the active
objective av-call session.

## M5 manual review gate #3 — M3/M4 chat regression on final stack

Automated unit tests in `m3-m4-meet-regression.test.ts` cover delivery-open seeding,
group history-sync predicates, pending flush planning, compose-first UX, and chat-data
transport retention while Meet is active. Before M5 sign-off item #3, repeat the M3
and M4 manual spot checks from `.agent-team/milestones.md` on the **final stack**
(with Meet enabled — same Homepage `/chat` session, no legacy interim message path).

### M3 DM spot checks (two Contacts users, same node)

1. Open a DM Space; send messages with both users online; confirm delivery and
   **send-timestamp order** in the thread.
2. With recipient **offline**, send messages; confirm **pending** state in sender UI.
3. Bring recipient **online**; confirm pending messages **send and appear** for both.
4. Refresh sender browser; confirm **local DM history** still displays (IndexedDB).
5. Optional devtools: websocket `/ws` carries signaling only — no chat message bodies.

**Meet coexistence:** start or accept a **DM Meet** on the same thread; confirm chat
compose stays enabled, pending flush still works after the call ends, and
`deliveryOpenPeers` resumes retries without requiring a fresh post-call delivery.

### M4 group spot checks (three Contacts users A, B, C — group Space ChatABC)

1. A and B online: exchange messages; C (offline) sees nothing yet.
2. C joins online: confirm C receives **late-joiner history from B**, including
   messages A sent while A was offline.
3. All three online: send from each; confirm **correct order by send time** even
   when deliveries arrive out of order.
4. Take A offline; B and C continue; bring A back; confirm A **catches up**.
5. Send while no peer path exists; confirm **pending**; confirm delivery when a peer
   returns.

**Meet coexistence:** start a **group Meet** with 3+ participants on the same Space;
confirm mesh **chat** (data channels) still delivers during or after the call, group
history sync on late join still works, and per-peer pending flush behaves as in M4.

Optional devtools: separate objective sessions for `chat-data` and `av-call` on the
same Space; both may share the websocket but use distinct session IDs and purposes.

## Future transport (requirements backlog)

**Per-peer connection pooling (not per-space):** For 1:1, one `RTCPeerConnection`
per remote account (not one per DM Space) with chat payloads tagged by
`spaceUuid` / thread id so the receiver routes to the correct UI thread. Reduces
duplicate ICE when the same contact appears in multiple DMs-only scenarios.

**Connection keep-alive / idle TTL:** When switching threads (e.g. DM with A → DM
with B → back to A), prefer retaining warm peer connections for a configurable idle
window instead of immediate teardown (today: non-selected DMs with no pending may
release transport — see H28 in `webrtc-debugging.md`). Trade memory and signaling
state for faster return-to-thread delivery.

**Out of scope for pooling as stated:** N-person **group** chat still needs either a
mesh (N−1 peer connections per member) or a different topology (hub/SFU/server
relay). A single “connection per user” cannot carry group fan-out without changing
that shape. **Meet** may also remain a separate negotiated session per Space even
if chat-data pooling lands later.

**Prerequisite work:** x-wrtcsig session model, join/roster/initiator rules, and
orchestrator runs are **space/session-centric** today; pooling requires a deliberate
signaling + client refactor, not a UI-only change.
