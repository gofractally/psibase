# Requirements — pslack WebRTC Meet

**Team:** `mm/webrtc-meet`
**Worktree:** `/root/psibase`
**Phase:** 0 (Requirements)
**Owner (PM):** drafted from User direction on 2026-05-06
**Builds on:** `.agent-team-x-pslack/requirements.md` and the implemented `pslack` websocket chat feature

## 1. Problem Statement

`pslack` should gain a lightweight WebRTC video meeting feature that lets two authenticated users move from an existing direct-message conversation into a live peer-to-peer audio/video call. The prior `x-pslack` work created the right foundation: authenticated websocket sessions, contact presence, direct-message conversations, participant-set "rooms", and a protocol slot for future WebRTC signaling.

This feature should use that existing chat/session mechanism as the signaling and authorization layer, while keeping media traffic peer-to-peer between browsers. The first slice is intentionally narrow: two-person calls only, launched from a DM, with a simple full-panel meeting UI and only the controls needed to mute audio, mute video, and end the call.

## 2. Goals

1. Add WebRTC meeting support as a feature of the existing `pslack` app, not as a separate Homepage app.
2. Support one-to-one mesh connectivity for the first version: browser-to-browser media, no SFU, no MCU, and no server-relayed media.
3. Reuse or minimally augment the `pslack` room/conversation mechanism so a DM conversation can authorize and route meeting signaling between its two members.
4. Let a user start a meeting from an active DM by clicking a new **Meet** button above the chat history panel.
5. Replace the chat content area with a focused video-conferencing UI while a call is active.
6. Show the remote participant's video as the primary/full-area feed and the local participant's camera preview as a picture-in-picture overlay at the bottom right.
7. Provide only three in-call controls in the first slice: audio mute/unmute, video mute/unmute, and end call.
8. Produce an architecture and test strategy before implementation tasks are split.

## 3. Non-Goals

- Do not build or introduce an SFU, MCU, media gateway, recording service, transcription service, or server-side media processing.
- Do not support group video calls in the first slice, even though the eventual mesh model should not make that impossible.
- Do not add screen sharing, chat overlays inside the call, reactions, hand raising, background blur, device settings panels, ringing tones, call history, scheduled meetings, or meeting links.
- Do not make anonymous or guest calling part of this feature. Both callers must be authenticated chain accounts.
- Do not replace the current pslack DM and group-chat experience.
- Do not add durable service-side call recordings or durable service-side media metadata beyond what is required for transient call setup and cleanup.

## 4. User Experience Requirements

### 4.1 Starting A Call

- A signed-in user opens `pslack`, starts or selects a DM with one contact, and sees a **Meet** button just above the chat history panel.
- The **Meet** button is shown only for a two-person DM. It is not shown for group chats in the first slice.
- Clicking **Meet** starts an outbound call attempt to the other DM participant.
- If the local user has not already granted camera or microphone permissions, the browser permission prompt is expected. The UI should clearly explain that camera and microphone access are needed.
- If camera or microphone permission is denied, the call should fail gracefully with a clear message and leave the user in the DM view or return them there.
- If the other participant is offline or cannot be reached over the pslack websocket, the caller should see a clear failure state and stay in or return to the DM.

### 4.2 Receiving A Call

- When a user receives a meeting invite for the currently selected or any known DM, pslack should present a clear incoming-call state naming the caller.
- The receiving user can accept or decline the call. Accepting joins the WebRTC meeting; declining notifies the caller and returns both sides to normal chat state.
- An unanswered incoming call should time out after 20 seconds.
- The first slice does not require push notifications or OS-level notifications. The receiver must have pslack open and an active websocket session.
- If the receiver is already in another call, the invite should be rejected or declined with a clear reason.

### 4.3 In-Call Layout

- Once the call is connected, the contents of the pslack main content area are replaced with the conferencing UI.
- The remote participant's video feed fills the available pslack content area.
- The local participant's video feed appears as a picture-in-picture preview anchored to the bottom-right corner of the remote video area.
- The in-call controls are visible and limited to:
  - audio mute/unmute,
  - video mute/unmute,
  - end call.
- The UI should show useful transient states: calling, incoming call, connecting media, connected, reconnecting/connection degraded, call ended, and call failed.
- If the remote participant has video muted, no camera stream, or is in audio-only mode, the primary area should be blank or subdued with a minimal message such as "remote video muted" or "audio only".
- If the local user mutes video, the local picture-in-picture should reflect that muted state.
- If the local user toggles video off and then back on during an active call, the local picture-in-picture preview must resume showing the local camera stream without requiring a call restart. The preview should stay bound to the active local media stream or be reattached after track replacement/re-enablement.
- If either participant mutes their microphone, the other participant should see a clear remote-muted indicator associated with that participant. For a two-person call this can be a small microphone-muted badge or label over the remote video area.
- Ending the call returns the user to the same DM conversation.

### 4.4 Responsive Scope

- Desktop and typical laptop browser layouts are the priority for the first slice.
- Mobile-specific call UX is out of scope, but the implementation should not intentionally break the existing responsive pslack layout outside active calls.

## 5. Connectivity And Media Requirements

- The first version supports exactly two participants per call.
- Media must use direct WebRTC peer connections between the two browsers.
- The service must not receive, relay, inspect, record, or transform audio/video media.
- The architecture should describe the expected ICE configuration:
  - Prefer free, internet-available STUN/TURN options if suitable for this first slice.
  - If a free TURN service requires account setup, the team should ask the User before implementation begins.
  - If no suitable free TURN option is available, the first slice may ship without TURN relay and should fail gracefully when a direct connection cannot be established.
  - If TURN is unavailable, the requirements and UI must acknowledge that some NAT combinations may fail.
- The app should request audio and video tracks using browser WebRTC APIs and attach those tracks to the local peer connection.
- The app should support toggling local audio/video by enabling/disabling tracks without renegotiating unless the architecture determines renegotiation is necessary.
- If camera access or camera hardware is unavailable but microphone access succeeds, the app should transparently fall back to an audio-only call rather than aborting the call.
- The app should cleanly stop local media tracks when the call ends or fails.
- The app should handle common browser/runtime failures: missing `navigator.mediaDevices`, permission denial, no camera, no microphone, ICE failure, remote hangup, websocket disconnect during setup, and page/app unmount.

## 6. Signaling And Room Requirements

- The existing pslack websocket remains the control transport for chat and meeting signaling.
- Meeting signaling should reuse the authenticated websocket session and conversation authorization already established for pslack.
- A meeting is associated with a DM conversation. Both participants must be members of that DM conversation.
- The service should reject meeting signaling for:
  - unauthenticated users,
  - non-members of the DM conversation,
  - group conversations in the first slice,
  - malformed or stale call/session identifiers,
  - attempts to target a user other than the other DM participant.
- The protocol should define explicit client and server message shapes for:
  - starting or inviting to a call,
  - accepting a call,
  - declining or rejecting a call,
  - exchanging WebRTC offer/answer SDP,
  - exchanging ICE candidates,
  - reporting local media-state changes such as microphone muted/unmuted and camera muted/unmuted,
  - ending a call,
  - reporting call setup or authorization errors.
- Recommendation for architecture: use first-class typed call frames in the pslack protocol instead of hiding all meeting traffic inside a generic `signal` payload. The existing reserved signaling concept can still guide the design, but explicit frame types should make validation, authorization, logging, and tests clearer.
- Signaling messages should be routed only to the other DM member. No call signaling should be broadcast to unrelated users or group-chat members.
- Signaling state should be transient. The service may track active call setup state for routing, validation, collision handling, and cleanup, but it should not persist call history as a durable source of truth in the first slice.
- Call setup should include a call/session identifier so late, duplicate, or cross-call signaling messages can be ignored or rejected.
- If both DM participants click **Meet** around the same time, the first valid call initiation received by the service should win. If the service cannot establish ordering for a tie, the account name that sorts first lexicographically should win.
- If a user has multiple pslack tabs open, only the active pslack tab should receive or own an incoming call. The architecture should define how "active" is detected and advertised.
- The architecture should define cleanup behavior when either websocket closes during calling, connecting, or connected states.
- Call lifecycle events and failures should be rendered as messages in the DM chat history, similar to common chat apps with video calls. Examples include missed call, declined call, call failed, connection failed, and call ended.

## 7. Frontend Requirements

- Implement the feature inside the existing pslack frontend structure and reuse established styling, component, hook, and websocket-client patterns.
- Extend the pslack websocket client/protocol layer rather than opening a second app-level websocket only for meetings, unless architecture finds a strong reason to separate them.
- Keep meeting state isolated enough that normal chat behavior remains understandable after a call ends, fails, or is declined.
- The DM view should expose a clear place for the **Meet** button above the chat history panel.
- The meeting UI should manage:
  - local media permission and stream acquisition,
  - RTCPeerConnection lifecycle,
  - offer/answer creation and application,
  - ICE candidate buffering and exchange,
  - remote stream attachment,
  - mute/video toggle state,
  - local picture-in-picture stream reattachment after video track disable/enable or replacement,
  - remote participant media-state indicators for microphone and camera mute state,
  - hangup and cleanup.
- Call setup failures and timeouts should add clear status messages into the associated DM conversation rather than only showing ephemeral toast/banner state.
- The implementation should avoid leaking local media tracks after unmount, navigation, websocket closure, failed setup, or explicit end call.
- The UI should never imply that the server is carrying media. User-facing copy can say peer-to-peer or direct connection if an explanation is needed.

## 8. Service Requirements

- Extend the existing `x-pslack` subjective service to authorize and route WebRTC signaling.
- Preserve the existing chat, presence, DM, and group-chat behavior.
- Continue to use the chain/authenticated account as the trust boundary.
- Maintain call setup/routing state subjectively and transiently.
- Ensure that a user can participate in at most one active pslack call at a time in the first slice.
- Validate every signaling frame against the authenticated sender, target conversation, target account, and current call/session state.
- Route authenticated in-call media-state updates, such as microphone muted/unmuted and camera muted/unmuted, only to the other participant in the active DM call.
- Send clear structured errors for rejected signaling attempts so the frontend can present understandable failure states.
- Clean up active call state when:
  - a participant ends the call,
  - a participant declines,
  - an incoming call is unanswered for 20 seconds,
  - a participant websocket closes,
  - call setup times out,
  - ICE/media setup fails and the client reports failure.

## 9. Acceptance Criteria

The feature is ready for review when:

- Two authenticated users can open a pslack DM and the caller can start a meeting with the **Meet** button.
- The receiver sees an incoming-call state and can accept or decline.
- On accept, both browsers establish a direct WebRTC audio/video connection without server-side media relay.
- The connected call replaces the pslack content area with the remote video primary layout and local picture-in-picture preview.
- Audio mute/unmute, video mute/unmute, and end call work for the local participant.
- Toggling local video off and back on restores the local picture-in-picture preview in the active call.
- When either participant mutes or unmutes their microphone, the other participant sees the remote participant's current muted/unmuted state in the call UI.
- Ending the call from either side tears down the peer connection, stops local tracks, notifies the other participant, and returns both users to the DM.
- Declining a call notifies the caller and returns both users to normal DM state.
- Unanswered calls time out after 20 seconds and add a missed-call style message to the DM.
- Camera failure falls back to audio-only when microphone access is available.
- A group chat does not expose or allow the first-slice **Meet** flow.
- Non-members cannot send, receive, or spoof call signaling for a DM conversation.
- Stale, duplicate, or cross-call signaling frames do not connect the wrong users or corrupt active call state.
- Websocket disconnect during call setup or active call produces a clear UI state and cleans up service-side transient call state.
- The WebSocket/WebRTC signaling protocol is documented in the architecture or developer docs.
- Automated service/protocol tests cover signaling authorization, invite/accept/decline, timeout, offer/answer/ICE routing, non-member rejection, group rejection, collision handling, active-tab routing, and cleanup.
- Manual browser verification is acceptable for the first WebRTC media flow because reliable automated browser testing for WebRTC can be handled in a later testing pass.

## 10. Explicitly Out Of Scope For First Slice

- Calls with more than two participants.
- SFU/MCU media routing, media servers, recording, transcription, livestreaming, and server-side media inspection.
- Screen sharing.
- Device picker/settings UI for choosing camera, microphone, or speaker.
- Call history, missed-call history, scheduled meetings, meeting links, waiting rooms, passcodes, or lobby moderation.
- Push notifications, mobile-specific call notifications, or ringing when pslack is not open.
- End-to-end encrypted signaling beyond what WebRTC media already provides by default.
- Durable service-side storage of call events or media metadata.
- Cross-node call discovery or federation beyond what the current subjective pslack websocket model naturally supports.

## 11. Architecture Follow-Ups

1. Research free STUN/TURN options suitable for local development and early demos. If a free TURN account is required, ask the User to create it before implementation begins.
2. Determine where ICE server configuration should live so local development, demos, and future deployment can configure STUN/TURN without hard-coding credentials into the frontend.
3. Define the exact first-class pslack call frame names and payloads for invite, accept, decline, offer, answer, ICE candidate, media-state update, hangup, timeout, and error.
4. Define how the active pslack tab is detected, advertised, and cleaned up when a user has multiple tabs open.
5. Choose timeout values for incomplete offer/answer setup and ICE failure. The unanswered-call timeout is fixed at 20 seconds.
6. Verify browser security constraints for `getUserMedia` and WebRTC under psibase local development, including `psibase.localhost`, HTTPS/localhost treatment, and sibling subdomains.
7. Defer deep automated WebRTC browser testing strategy until after the first implementation plan; service/protocol testing remains required for signaling behavior.

## 12. Milestone 5 — Foundational Chat Additions

This milestone is focused entirely on the foundational Pslack chat experience. It should preserve existing DM, group-chat, presence, websocket, and Meet behavior while improving offline send semantics, sidebar polish, and group-chat creation/discovery.

### 12.1 Offline / Deferred Chat Sending

- A user can compose and send chat messages even when the target recipient is not currently online.
- A locally queued message appears immediately in the sender's conversation timeline as if it was sent, with a small pending-status icon next to the message. Use a conventional pending/clock-style icon unless the design system already has a better local equivalent.
- Pending messages are stored in psibase local storage on the sender's client. Local-only durability is acceptable for this milestone: queued messages are tied to the browser profile/device where they were composed.
- A pending DM message is delivered when the sender and receiver are both online.
- A pending group-chat message is delivered independently to each intended recipient as that recipient comes online. The message remains pending only for recipients that are still offline or not yet acknowledged.
- When the sender and an intended recipient are both online, the client attempts delivery to that recipient over the existing Pslack websocket protocol.
- After successful service acknowledgement, the pending icon is removed and the local queued copy is marked sent or pruned according to the existing local-history model.
- Pending messages must include stable client-generated IDs so retries after reconnect, page reload, or repeated online/offline transitions do not duplicate delivered messages.
- Pending, failed, and sent are the required message states for this milestone. Delivered/read receipts remain out of scope.
- The UI must make local-only durability clear enough for review: messages queued in one browser profile are not expected to appear in another browser or device before delivery.
- If the receiver is offline and the sender closes Pslack before delivery, delivery waits until the sender later reopens Pslack with local storage intact. The UI should not imply server-side guaranteed delivery.
- If local storage is unavailable, full, or corrupted, the user should see a clear send failure instead of silently losing a queued message.

### 12.2 DM Sidebar Limit

- The DMs section in the left sidebar should show a scrollable list with no more than 15 visible items.
- The visible-item limit must be expressed as a named constant, for example `MAX_VISIBLE_DM_ITEMS = 15`, so a future settings panel can tune it without hunting through layout code.
- The limit controls visible sidebar rows, not total conversations. Additional DMs remain reachable through scrolling.

### 12.3 Left Sidebar UI Tweaks

- Move the **New group chat** button to the top of the left sidebar column, above the **Contacts** header.
- Remove the **Conversation** header.
- For each listed account row, reduce the account-name font size from 16px to 14px.
- Remove the rounded-corner, card-looking border from each account row so the list reads more like a compact Slack-style sidebar.
- Preserve existing presence indicators and click/selection behavior while making these visual changes.

### 12.4 Group Chat Creation And Discovery

- When Account1 starts a group chat with Account2 and Account3 and sends a message, the group conversation must become visible in Account2's and Account3's Pslack UIs.
- The service/protocol should treat group-chat creation as a conversation event for all members, not only for the initiating account.
- Recipients should not need to manually create the same group locally before the first inbound group message appears.
- Group creation and first-message fanout must still enforce membership isolation: non-members cannot discover, receive, or send into the group.
- Reconnect/sync should return known group conversations so group chats created while a user was offline appear once the user reconnects, subject to this milestone's local/offline durability model.
- If two online participants in a larger group chat exchange messages while another participant is offline, the offline participant should receive the missed messages when they come online in the original chronological order, even when the missed messages came from multiple senders. This should reconstruct the coherent conversation that happened while the participant was absent.

### 12.5 Group Chat Display Names

- Group chat names are derived from the account names in that group chat rather than from user-entered channel names.
- The displayed label should omit the current user's own account name, scale to the available sidebar button/card width by taking the same prefix length `N` from each other account name, and join the results with `, `, ending with `...` when truncation is required.
- The intent is a label shaped like `<account1-prefix>, <account2-prefix>, <account3-prefix>...`, where each prefix length is chosen so the full label fits in the available row width.
- `N` is applied equally to every displayed account name, up to the full length of shorter names, and must never be less than 2.
- The truncation algorithm should be deterministic for the same participant set and viewport width, should keep participant order stable, and should avoid producing an empty prefix for any visible participant.
- The full account list should remain accessible on hover, focus, or selection details if the compact label truncates names.

### 12.6 Undelivered And New-Message Badges

- Conversations with messages that have not yet been delivered to every intended recipient should show an undelivered badge.
- The badge should reflect undelivered state, not unread state. It is intended to help users see which conversations still have pending outbound delivery.
- When new messages arrive from another sender, the conversation row should show a count of new unread messages.
- Messages are marked read as soon as that conversation thread has been clicked on or displayed.

### 12.7 Acceptance Criteria

- A DM message sent while the receiver is offline appears immediately for the sender with a pending icon, survives page reload through psibase local storage, and is sent once both sender and receiver are online.
- Retrying a pending message does not create duplicates after reconnect or reload.
- A group message sent while one or more group members are offline is delivered to online recipients immediately and remains pending only for offline or unacknowledged recipients.
- When an offline group participant returns, missed messages from multiple senders are displayed in chronological order so the absent participant sees the coherent conversation that happened while they were offline.
- The DMs sidebar section displays at most `MAX_VISIBLE_DM_ITEMS` rows before scrolling.
- The **New group chat** button appears above **Contacts**, the **Conversation** header is gone, account rows use 14px names, and the account-row card border/radius is removed.
- Creating a group chat and sending its first message from one account causes the group conversation and message to appear for every online group member, and to appear for offline members after reconnect according to the milestone's delivery model.
- Group-chat labels fit within their sidebar row without overflowing and expose the full participant list through an accessible affordance.
- Conversations with outbound undelivered messages show an undelivered badge, and conversations with new inbound messages show a sender/new-message count until the conversation is displayed.
- Existing Meet behavior, DM sending, group-chat membership checks, websocket reconnect behavior, and presence display continue to work.

### 12.8 Product Decisions And Deferred Gaps

- **Resolved delivery guarantee:** Group-chat messages send to each member as they come online and remain pending only for members that are not online or not yet acknowledged.
- **Resolved local-only durability:** Browser/profile-local pending storage is acceptable for this milestone.
- **Resolved ack states:** Pending, failed, and sent are required. Delivered/read receipts are deferred.
- **Resolved offline recipient visibility:** If the sender closes Pslack before delivery, delivery depends on that sender later reopening Pslack with local storage intact.
- **Resolved notification scope:** Add undelivered badges and new-message counts. Full unread modeling, desktop notifications, and push notifications remain deferred.
- **Resolved group-name truncation:** Apply the same `N` to each displayed account name, omit the current user's own name, and use minimum `N = 2`.
- **Deferred Slack-like features:** Message edits, deletes, reactions, threads, files, and search are understood as future work and not part of this milestone.

## 13. Phase Plan

- **Phase 0:** PM drafts and confirms requirements.
- **Phase 1:** Architect explores the implemented pslack app, existing websocket protocol, browser media constraints, and psibase local-service patterns; then proposes `architecture.md` with signaling protocol, frontend state model, service state model, WebRTC lifecycle, cleanup behavior, and test strategy.
- **Phase 2:** Senior splits the implementation into reviewable tasks for protocol/service updates, frontend call state and UI, WebRTC peer lifecycle, foundational chat additions, and verification.
