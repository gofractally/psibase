//! WebRTC session join and SDP/ICE routing against objective Chat metadata (§6.3–6.4).
//! ICE merge/validation for welcome frames lives in [`crate::ice_config`] (§11.4).
//!
//! ## Signal delivery contract
//!
//! SDP/ICE `signal` frames are delivered **only** to websocket sockets whose user
//! has called `joinSession` for that `session_id` (rows in `SigSessionJoinTable`).
//! We do **not** fall back to every live socket for the recipient: a transport that
//! is up but has not joined (or has not installed client handlers yet) would
//! silently drop frames.
//!
//! When no joined socket exists for the recipient, frames are buffered via
//! [`crate::state::enqueue_pending_signal`] and atomically flushed by
//! [`handle_join_session`] through [`flush_pending_signals_to_socket`].
//! Clients must tolerate reordering across reconnects, but once joined they
//! receive buffered signals in enqueue order followed by live traffic.

use std::collections::BTreeSet;

use psibase::services::chat::{self, Wrapper as Chat};
use psibase::AccountNumber;
use psibase::ExactAccountNumber;

use crate::protocol::{
    decode_server_frame_json, encode_server_frame, ChatAppMetadata, ClientFrame, DataChannelSpec,
    ServerFrame, SignalKind,
};
use crate::state::{
    enqueue_pending_signal, erase_sig_session_join, live_sockets_for_user, put_sig_session_join,
    sig_join_row, sig_joins_for_session, sig_joins_for_socket, take_pending_signal_payloads,
};
#[cfg(feature = "rt-trace")]
use crate::trace::xrtcsig_trace;
use crate::state::tables::SigSessionJoinRow;

pub const APP_SERVICE_CHAT: &str = "chat";
pub const PURPOSE_CHAT_DATA: &str = "chat-data";
pub const PURPOSE_AV_CALL: &str = "av-call";
pub const CHAT_DATA_CHANNEL_LABEL: &str = "chat";
pub const TRANSPORT_AUDIO: &str = "audio";
pub const TRANSPORT_VIDEO: &str = "video";

const EVENT_PARTICIPANT_LEFT: u8 = 2;
pub(crate) const EVENT_SESSION_FAILED: u8 = 3;
pub(crate) const EVENT_SESSION_ENDED: u8 = 4;

fn sig_service() -> AccountNumber {
    psibase::account!("x-webrtcsig")
}

fn leave_lifecycle_event_kind(
    purpose: &str,
    participant_count: usize,
    reason: &str,
    joined_count: usize,
) -> u8 {
    if purpose == PURPOSE_AV_CALL && participant_count > 2 {
        EVENT_PARTICIPANT_LEFT
    } else if purpose == PURPOSE_AV_CALL && participant_count <= 2 {
        let still_ringing = joined_count < participant_count;
        if still_ringing && matches!(reason, "timeout" | "missed") {
            EVENT_SESSION_FAILED
        } else {
            EVENT_SESSION_ENDED
        }
    } else {
        EVENT_PARTICIPANT_LEFT
    }
}

fn normalize_leave_reason(reason: Option<String>) -> String {
    match reason.as_deref() {
        Some("invite-timeout") => "timeout".into(),
        Some(other) => other.into(),
        None => "user".into(),
    }
}

fn query_session_auth(session_id: &str, account: AccountNumber) -> chat::SessionJoinAuth {
    Chat::call_from(sig_service()).authorizeSessionJoin(session_id.into(), account)
}

pub(crate) fn query_session_auth_for_cleanup(session_id: &str) -> chat::SessionJoinAuth {
    query_session_auth(session_id, sig_service())
}

fn session_err(
    socket: i32,
    code: &str,
    reason: &str,
    session_id: Option<String>,
) -> (i32, ServerFrame) {
    (
        socket,
        ServerFrame::Error {
            code: code.into(),
            reason: reason.into(),
            session_id,
        },
    )
}

fn chat_data_channels() -> Vec<DataChannelSpec> {
    vec![DataChannelSpec {
        label: CHAT_DATA_CHANNEL_LABEL.into(),
        ordered: true,
    }]
}

fn chat_data_transports() -> Vec<String> {
    Vec::new()
}

fn av_call_transports() -> Vec<String> {
    vec![TRANSPORT_AUDIO.into(), TRANSPORT_VIDEO.into()]
}

fn av_call_data_channels() -> Vec<DataChannelSpec> {
    Vec::new()
}

fn is_supported_signaling_purpose(purpose: &str) -> bool {
    purpose == PURPOSE_CHAT_DATA || purpose == PURPOSE_AV_CALL
}

fn session_invite_payload(auth: &chat::SessionJoinAuth) -> (Vec<String>, Vec<DataChannelSpec>) {
    match auth.purpose.as_str() {
        PURPOSE_CHAT_DATA => (chat_data_transports(), chat_data_channels()),
        PURPOSE_AV_CALL => (av_call_transports(), av_call_data_channels()),
        _ => (Vec::new(), Vec::new()),
    }
}

pub fn session_invite_frame(auth: &chat::SessionJoinAuth, from: AccountNumber) -> ServerFrame {
    let participants: Vec<ExactAccountNumber> = auth
        .participants
        .iter()
        .copied()
        .map(Into::into)
        .collect();
    let (transports, data_channels) = session_invite_payload(auth);
    ServerFrame::SessionInvite {
        session_id: auth.session_id.clone(),
        app_service: APP_SERVICE_CHAT.into(),
        app_session_id: auth.space_uuid.clone(),
        purpose: auth.purpose.clone(),
        from: from.into(),
        participants,
        transports,
        data_channels,
        expires_at: auth.expires_at,
        app_metadata: ChatAppMetadata {
            space_uuid: auth.space_uuid.clone(),
        },
    }
}

fn fanout_to_participant_sockets(
    participants: &[AccountNumber],
    except: Option<AccountNumber>,
    frame: &ServerFrame,
) -> Vec<(i32, ServerFrame)> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for participant in participants {
        if except == Some(*participant) {
            continue;
        }
        for sock in live_sockets_for_user(*participant) {
            if seen.insert(sock) {
                out.push((sock, frame.clone()));
            }
        }
    }
    out
}

fn fanout_participant_joined(
    session_id: &str,
    participant: AccountNumber,
    peers: &[AccountNumber],
) -> Vec<(i32, ServerFrame)> {
    let frame = ServerFrame::ParticipantJoined {
        session_id: session_id.into(),
        participant: participant.into(),
    };
    fanout_to_participant_sockets(peers, Some(participant), &frame)
}

/// F1: ground-truth session roster broadcast.
///
/// Compute the current set of joined accounts for the session (deduplicated
/// across multiple sockets per account) and return a `sessionSnapshot`
/// frame ready to broadcast. Pending participants are the auth-list members
/// not currently joined. The epoch is `joined.len()` so clients can detect
/// changes monotonically even without comparing lists.
fn build_session_snapshot(
    session_id: &str,
    participants: &[AccountNumber],
) -> ServerFrame {
    let mut joined_accounts: Vec<AccountNumber> = Vec::new();
    for row in sig_joins_for_session(session_id) {
        if !joined_accounts.iter().any(|a| *a == row.account) {
            joined_accounts.push(row.account);
        }
    }
    let joined_participants: Vec<ExactAccountNumber> = participants
        .iter()
        .copied()
        .filter(|p| joined_accounts.iter().any(|a| *a == *p))
        .map(Into::into)
        .collect();
    let pending_participants: Vec<ExactAccountNumber> = participants
        .iter()
        .copied()
        .filter(|p| !joined_accounts.iter().any(|a| *a == *p))
        .map(Into::into)
        .collect();
    ServerFrame::SessionSnapshot {
        session_id: session_id.into(),
        epoch: joined_participants.len() as u64,
        joined_participants,
        pending_participants,
    }
}

/// Broadcast a session snapshot to every joined socket for the session
/// (every joiner, including the one whose action triggered the change).
/// This is the ground-truth roster the client FSM consumes.
fn fanout_session_snapshot(
    session_id: &str,
    participants: &[AccountNumber],
) -> Vec<(i32, ServerFrame)> {
    let snapshot = build_session_snapshot(session_id, participants);
    let mut joined_accounts: Vec<AccountNumber> = Vec::new();
    for row in sig_joins_for_session(session_id) {
        if !joined_accounts.iter().any(|a| *a == row.account) {
            joined_accounts.push(row.account);
        }
    }
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for row in sig_joins_for_session(session_id) {
        if seen.insert(row.socket) {
            out.push((row.socket, snapshot.clone()));
        }
    }
    // Pending auth participants still need ground-truth roster on their active
    // tab socket (e.g. background DM while focused on a group thread).
    for participant in participants {
        if joined_accounts.iter().any(|a| *a == *participant) {
            continue;
        }
        for sock in live_sockets_for_user(*participant) {
            if seen.insert(sock) {
                out.push((sock, snapshot.clone()));
            }
        }
    }
    out
}

/// Deliver SDP/ICE only to sockets that have actually joined this session.
///
/// We deliberately do NOT fall back to `live_sockets_for_user`: a peer whose
/// transport is alive but whose UI hasn't installed signaling handlers yet
/// (e.g. landed on the chat shell but not on this DM thread) would silently
/// drop the frame. Buffering via `enqueue_pending_signal` lets
/// `flush_pending_signals_to_socket` redeliver everything atomically once the
/// peer's `joinSession` arrives.
fn fanout_signal_to_peer(
    session_id: &str,
    to: AccountNumber,
    frame: &ServerFrame,
) -> Vec<(i32, ServerFrame)> {
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for join in sig_joins_for_session(session_id) {
        if join.account != to {
            continue;
        }
        if seen.insert(join.socket) {
            out.push((join.socket, frame.clone()));
        }
    }
    out
}

fn redeliver_pending_signals(
    session_id: &str,
    to: AccountNumber,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    let payloads = take_pending_signal_payloads(session_id, to);
    let mut out = Vec::new();
    for payload in payloads {
        let Ok(frame) = decode_server_frame_json(&payload) else {
            continue;
        };
        let delivers = fanout_signal_to_peer(session_id, to, &frame);
        if delivers.is_empty() {
            if let Ok(payload) = encode_server_frame(&frame) {
                enqueue_pending_signal(session_id, to, now, payload);
            }
        } else {
            out.extend(delivers);
        }
    }
    out
}

fn flush_pending_signals_to_socket(
    session_id: &str,
    to: AccountNumber,
    socket: i32,
) -> Vec<(i32, ServerFrame)> {
    let mut out = Vec::new();
    for payload in take_pending_signal_payloads(session_id, to) {
        match decode_server_frame_json(&payload) {
            Ok(frame) => out.push((socket, frame)),
            Err(_) => continue,
        }
    }
    out
}

fn record_join(
    session_id: &str,
    account: AccountNumber,
    socket: i32,
    client_instance_id: &str,
    now: i64,
) {
    put_sig_session_join(&SigSessionJoinRow {
        session_id: session_id.to_owned(),
        account,
        socket,
        client_instance_id: client_instance_id.to_owned(),
        joined_at: now,
    });
}

fn join_session_auth_errors(
    socket: i32,
    session_id: &str,
    auth: &chat::SessionJoinAuth,
) -> Option<Vec<(i32, ServerFrame)>> {
    if auth.purpose.is_empty() {
        return Some(vec![session_err(
            socket,
            "unknown-session",
            "unknown session",
            Some(session_id.to_owned()),
        )]);
    }

    if auth.expired {
        return Some(vec![session_err(
            socket,
            "session-expired",
            "session has expired",
            Some(session_id.to_owned()),
        )]);
    }

    if auth.lifecycle != 1 {
        return Some(vec![session_err(
            socket,
            "session-not-active",
            "session is not active",
            Some(session_id.to_owned()),
        )]);
    }

    if !auth.authorized {
        return Some(vec![session_err(
            socket,
            "not-participant",
            "account is not a participant in this session",
            Some(session_id.to_owned()),
        )]);
    }

    if !is_supported_signaling_purpose(&auth.purpose) {
        return Some(vec![session_err(
            socket,
            "unsupported-purpose",
            "unsupported session purpose for signaling",
            Some(session_id.to_owned()),
        )]);
    }

    None
}

fn join_session_subjective(
    socket: i32,
    user: AccountNumber,
    session_id: String,
    client_instance_id: String,
    now: i64,
    auth: chat::SessionJoinAuth,
) -> Vec<(i32, ServerFrame)> {
    let prior = sig_join_row(&session_id, user);
    let duplicate_same_socket =
        prior.as_ref().is_some_and(|row| row.socket == socket);
    record_join(
        &session_id,
        user,
        socket,
        &client_instance_id,
        now,
    );
    crate::cleanup::note_session_activity(&session_id, now);

    // Deliver any signals buffered while this user had no joined socket.
    let flushed = flush_pending_signals_to_socket(&session_id, user, socket);

    // Multi-pair mesh: one browser tab joins several pair sessions on the same
    // websocket. Multiple inline sends during the second join abort the recv
    // action and can kill the socket (no frames reach the client). Return a
    // single sessionSnapshot; clients complete join from roster ground truth.
    let socket_has_other_sessions = sig_joins_for_socket(socket)
        .iter()
        .any(|row| row.session_id != session_id);
    if socket_has_other_sessions {
        let mut out = vec![(
            socket,
            build_session_snapshot(&session_id, &auth.participants),
        )];
        out.extend(flushed);
        return out;
    }

    if duplicate_same_socket {
        if socket_has_other_sessions {
            let mut out = vec![(
                socket,
                build_session_snapshot(&session_id, &auth.participants),
            )];
            out.extend(flushed);
            return out;
        }
        // Re-send invite so clients can recover after duplicate joinSession (e.g. UI retries).
        let invite = session_invite_frame(&auth, user);
        let mut out = vec![(socket, invite)];
        out.extend(flushed);
        // F1: include the current snapshot so the retrying client sees the
        // same roster every other peer sees.
        out.push((socket, build_session_snapshot(&session_id, &auth.participants)));
        return out;
    }

    let invite = session_invite_frame(&auth, user);
    let mut out = vec![(socket, invite.clone())];
    out.extend(flushed);

    out.extend(fanout_participant_joined(
        &session_id,
        user,
        &auth.participants,
    ));
    out.extend(fanout_to_participant_sockets(
        &auth.participants,
        Some(user),
        &invite,
    ));

    // F1: every join is a roster delta. Broadcast the authoritative snapshot
    // to every joined socket (including the new joiner) so clients always
    // have ground truth — no inference from event sequences.
    out.extend(fanout_session_snapshot(&session_id, &auth.participants));

    out
}

fn join_session_subjective_frames(
    socket: i32,
    user: AccountNumber,
    session_id: String,
    client_instance_id: String,
    now: i64,
    auth: chat::SessionJoinAuth,
) -> Vec<(i32, ServerFrame)> {
    join_session_subjective(
        socket,
        user,
        session_id,
        client_instance_id,
        now,
        auth,
    )
}

fn join_session_subjective_tx_subjective(
    socket: i32,
    user: AccountNumber,
    session_id: String,
    client_instance_id: String,
    now: i64,
    auth: chat::SessionJoinAuth,
) -> Vec<(i32, ServerFrame)> {
    ::psibase::subjective_tx! {
        join_session_subjective_frames(
            socket,
            user,
            session_id.clone(),
            client_instance_id.clone(),
            now,
            auth.clone(),
        )
    }
}

fn join_session_subjective_tx(
    socket: i32,
    user: AccountNumber,
    session_id: String,
    client_instance_id: String,
    now: i64,
    auth: chat::SessionJoinAuth,
) -> Vec<(i32, ServerFrame)> {
    join_session_subjective_tx_subjective(
        socket,
        user,
        session_id,
        client_instance_id,
        now,
        auth,
    )
}

pub fn handle_join_session(
    socket: i32,
    user: AccountNumber,
    session_id: String,
    client_instance_id: String,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    let auth = query_session_auth(&session_id, user);
    if let Some(err) = join_session_auth_errors(socket, &session_id, &auth) {
        return err;
    }
    join_session_subjective_tx(
        socket,
        user,
        session_id,
        client_instance_id,
        now,
        auth,
    )
}

fn validate_signal_in_tx(
    socket: i32,
    user: AccountNumber,
    session_id: &str,
    to: AccountNumber,
) -> Result<(), ServerFrame> {
    let auth = query_session_auth(session_id, user);
    if !auth.authorized || auth.expired || auth.lifecycle != 1 {
        return Err(session_err(
            socket,
            "not-participant",
            "not authorized to signal in this session",
            Some(session_id.to_owned()),
        )
        .1);
    }
    if !is_supported_signaling_purpose(&auth.purpose) {
        return Err(session_err(
            socket,
            "unsupported-purpose",
            "unsupported session purpose for signaling",
            Some(session_id.to_owned()),
        )
        .1);
    }
    if sig_join_row(session_id, user).is_none() {
        return Err(session_err(
            socket,
            "not-joined",
            "join the session before sending signals",
            Some(session_id.to_owned()),
        )
        .1);
    }
    if !auth.participants.iter().any(|p| *p == to) {
        return Err(session_err(
            socket,
            "bad-recipient",
            "signal recipient is not a session participant",
            Some(session_id.to_owned()),
        )
        .1);
    }
    if to == user {
        return Err(session_err(
            socket,
            "bad-recipient",
            "cannot signal yourself",
            Some(session_id.to_owned()),
        )
        .1);
    }
    Ok(())
}

pub fn handle_signal(
    socket: i32,
    user: AccountNumber,
    session_id: String,
    to: AccountNumber,
    kind: SignalKind,
    sdp: Option<String>,
    candidate: Option<String>,
    sdp_mid: Option<String>,
    sdp_mline_index: Option<u32>,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    ::psibase::subjective_tx! {
        if let Err(frame) = validate_signal_in_tx(socket, user, &session_id, to) {
            vec![(socket, frame)]
        } else {
            crate::cleanup::note_session_activity(&session_id, now);
            let outbound = ServerFrame::Signal {
                session_id: session_id.clone(),
                from: user.into(),
                to: to.into(),
                kind,
                sdp: sdp.clone(),
                candidate: candidate.clone(),
                sdp_mid: sdp_mid.clone(),
                sdp_mline_index,
            };

            let mut delivers = fanout_signal_to_peer(&session_id, to, &outbound);
            if delivers.is_empty() {
                if let Ok(payload) = encode_server_frame(&outbound) {
                    enqueue_pending_signal(&session_id, to, now, payload);
                }
            }
            delivers.extend(redeliver_pending_signals(&session_id, to, now));
            #[cfg(feature = "rt-trace")]
            if delivers.is_empty() {
                let join_socks: Vec<i32> = sig_joins_for_session(&session_id)
                    .into_iter()
                    .filter(|join| join.account == to)
                    .map(|join| join.socket)
                    .collect();
                let live = live_sockets_for_user(to);
                xrtcsig_trace!(
                    "[xrtcsig-trace] signal-no-delivery session={} to={} join_socks={:?} live_socks={:?}\n",
                    session_id,
                    to,
                    join_socks,
                    live,
                );
            }
            delivers
        }
    }
}

fn leave_session_subjective(
    socket: i32,
    user: AccountNumber,
    session_id: String,
    reason: Option<String>,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    let _ = now;
    let auth = query_session_auth(&session_id, user);
    if auth.purpose.is_empty() {
        return vec![session_err(
            socket,
            "unknown-session",
            "unknown session",
            Some(session_id),
        )];
    }

    if sig_join_row(&session_id, user).is_none() {
        return vec![session_err(
            socket,
            "not-joined",
            "not joined to this session",
            Some(session_id),
        )];
    }

    erase_sig_session_join(&session_id, user);
    let joined_before = sig_joins_for_session(&session_id).len() + 1;
    let reason_str = normalize_leave_reason(reason);

    let event_kind = leave_lifecycle_event_kind(
        &auth.purpose,
        auth.participants.len(),
        &reason_str,
        joined_before,
    );
    crate::cleanup::cleanup_session_if_terminal(&session_id, &auth, event_kind);

    let ended = ServerFrame::SessionEnded {
        session_id: session_id.clone(),
        by: user.into(),
        reason: reason_str.clone(),
    };
    let mut out = fanout_participant_sockets(&auth.participants, Some(user), &ended);
    out.push((socket, ended));
    out
}

fn leave_session_subjective_frames(
    socket: i32,
    user: AccountNumber,
    session_id: String,
    reason: Option<String>,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    leave_session_subjective(socket, user, session_id, reason, now)
}

fn leave_session_subjective_tx_subjective(
    socket: i32,
    user: AccountNumber,
    session_id: String,
    reason: Option<String>,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    ::psibase::subjective_tx! {
        leave_session_subjective_frames(
            socket,
            user,
            session_id.clone(),
            reason.clone(),
            now,
        )
    }
}

fn leave_session_subjective_tx(
    socket: i32,
    user: AccountNumber,
    session_id: String,
    reason: Option<String>,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    leave_session_subjective_tx_subjective(socket, user, session_id, reason, now)
}

pub fn handle_leave_session(
    socket: i32,
    user: AccountNumber,
    session_id: String,
    reason: Option<String>,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    leave_session_subjective_tx(socket, user, session_id, reason, now)
}

fn fanout_participant_sockets(
    participants: &[AccountNumber],
    except: Option<AccountNumber>,
    frame: &ServerFrame,
) -> Vec<(i32, ServerFrame)> {
    fanout_to_participant_sockets(participants, except, frame)
}

pub(crate) fn fanout_session_ended_to_participants(
    participants: &[AccountNumber],
    frame: &ServerFrame,
) -> Vec<(i32, ServerFrame)> {
    fanout_to_participant_sockets(participants, None, frame)
}

pub fn handle_participant_state(
    socket: i32,
    user: AccountNumber,
    session_id: String,
    state: crate::protocol::ParticipantStatePayload,
) -> Vec<(i32, ServerFrame)> {
    ::psibase::subjective_tx! {
        let auth = query_session_auth(&session_id, user);
        if !auth.authorized || auth.expired || auth.lifecycle != 1 {
            return vec![session_err(
                socket,
                "not-participant",
                "not authorized in this session",
                Some(session_id),
            )];
        }
        if sig_join_row(&session_id, user).is_none() {
            return vec![session_err(
                socket,
                "not-joined",
                "join the session before sending participant state",
                Some(session_id),
            )];
        }

        let joins = sig_joins_for_session(&session_id);
        let mut seen = BTreeSet::new();
        let mut out = Vec::new();
        let frame = ServerFrame::ParticipantState {
            session_id: session_id.clone(),
            participant: user.into(),
            state: state.clone(),
        };
        for join in joins {
            if join.account == user {
                continue;
            }
            if seen.insert(join.socket) {
                out.push((join.socket, frame.clone()));
            }
        }
        out
    }
}

/// Subjective join teardown for a dead socket. Caller must already be in `subjective_tx!`.
///
/// F1: transport-level drops emit `TransportLost`, not `SessionEnded`. The
/// distinction matters: clients treat `SessionEnded` as fatal (the FSM
/// transitions to `failed` and tears down every peer), but a single
/// participant's websocket dying is recoverable — the session itself is
/// still alive on chain, and the other peers should keep their existing
/// connections and just dispose the connection to the now-disconnected
/// participant. They'll re-establish when the lost participant returns
/// (via a fresh `joinSession` → `sessionSnapshot` broadcast).
pub(crate) fn tear_down_sessions_for_dead_socket_subjective(
    dead_socket: i32,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    let _ = now;
    let joins = crate::state::sig_joins_for_socket(dead_socket);
    if joins.is_empty() {
        return vec![];
    }

    let mut out = Vec::new();
    for join in joins {
        let auth = query_session_auth(&join.session_id, join.account);
        erase_sig_session_join(&join.session_id, join.account);

        // Recoverable transport drop: tell every other joined socket that
        // *this participant's* transport is gone. They keep the session.
        out.extend(fanout_participant_sockets(
            &auth.participants,
            Some(join.account),
            &ServerFrame::TransportLost {
                session_id: join.session_id.clone(),
                participant: join.account.into(),
            },
        ));

        // F1: roster delta. Broadcast the new snapshot to the remaining
        // joined sockets so they see the dead participant move from
        // `joined` to `pending`.
        out.extend(fanout_session_snapshot(
            &join.session_id,
            &auth.participants,
        ));
    }
    out
}

fn tear_down_sessions_for_dead_socket_inner(
    dead_socket: i32,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    ::psibase::subjective_tx! {
        tear_down_sessions_for_dead_socket_subjective(dead_socket, now)
    }
}

pub(crate) fn tear_down_sessions_for_dead_socket_tx(
    dead_socket: i32,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    tear_down_sessions_for_dead_socket_inner(dead_socket, now)
}

/// Tear down subjective joins for a dead socket (caller sends frames).
pub fn tear_down_sessions_for_dead_socket(
    dead_socket: i32,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    tear_down_sessions_for_dead_socket_tx(dead_socket, now)
}

pub struct SignalingDispatch {
    pub frames: Vec<(i32, ServerFrame)>,
}

pub fn dispatch_signaling_client_frame(
    socket: i32,
    user: AccountNumber,
    now: i64,
    frame: ClientFrame,
) -> SignalingDispatch {
    match frame {
        ClientFrame::JoinSession {
            session_id,
            client_instance_id,
        } => SignalingDispatch {
            frames: handle_join_session(socket, user, session_id, client_instance_id, now),
        },
        ClientFrame::Signal {
            session_id,
            to,
            kind,
            sdp,
            candidate,
            sdp_mid,
            sdp_mline_index,
        } => SignalingDispatch {
            frames: handle_signal(
                socket,
                user,
                session_id,
                to.into(),
                kind,
                sdp,
                candidate,
                sdp_mid,
                sdp_mline_index,
                now,
            ),
        },
        ClientFrame::LeaveSession { session_id, reason } => SignalingDispatch {
            frames: handle_leave_session(socket, user, session_id, reason, now),
        },
        ClientFrame::ParticipantState { session_id, state } => SignalingDispatch {
            frames: handle_participant_state(socket, user, session_id, state),
        },
        _ => SignalingDispatch { frames: vec![] },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use psibase::AccountNumber;

    #[test]
    fn av_call_leave_event_kind_maps_ringing_timeout_to_failed() {
        assert_eq!(
            leave_lifecycle_event_kind(PURPOSE_AV_CALL, 2, "timeout", 1),
            EVENT_SESSION_FAILED
        );
        assert_eq!(
            leave_lifecycle_event_kind(PURPOSE_AV_CALL, 2, "declined", 1),
            EVENT_SESSION_ENDED
        );
        assert_eq!(
            leave_lifecycle_event_kind(PURPOSE_AV_CALL, 2, "ended", 2),
            EVENT_SESSION_ENDED
        );
    }

    #[test]
    fn normalize_leave_reason_maps_invite_timeout() {
        assert_eq!(
            normalize_leave_reason(Some("invite-timeout".into())),
            "timeout"
        );
    }

    #[test]
    fn session_err_frame_includes_code_and_session_id() {
        let (_, frame) = session_err(
            7,
            "not-participant",
            "account is not a participant in this session",
            Some("wrtc:abc".into()),
        );
        match frame {
            ServerFrame::Error {
                code,
                reason,
                session_id,
            } => {
                assert_eq!(code, "not-participant");
                assert!(reason.contains("participant"));
                assert_eq!(session_id.as_deref(), Some("wrtc:abc"));
            }
            _ => panic!("expected error frame"),
        }
    }

    #[test]
    fn chat_data_channel_spec_is_ordered_chat_label() {
        let channels = chat_data_channels();
        assert_eq!(channels.len(), 1);
        assert_eq!(channels[0].label, CHAT_DATA_CHANNEL_LABEL);
        assert!(channels[0].ordered);
        assert!(chat_data_transports().is_empty());
    }

    #[test]
    fn session_invite_wires_chat_data_metadata() {
        let auth = chat::SessionJoinAuth {
            session_id: "wrtc:abc".into(),
            authorized: true,
            purpose: PURPOSE_CHAT_DATA.into(),
            space_uuid: "space:dm-1".into(),
            participants: vec![
                AccountNumber::from("alice"),
                AccountNumber::from("bob"),
            ],
            lifecycle: 1,
            expires_at: 99,
            expired: false,
        };
        let frame = session_invite_frame(&auth, AccountNumber::from("alice"));
        match frame {
            ServerFrame::SessionInvite {
                app_service,
                purpose,
                data_channels,
                app_metadata,
                ..
            } => {
                assert_eq!(app_service, APP_SERVICE_CHAT);
                assert_eq!(purpose, PURPOSE_CHAT_DATA);
                assert_eq!(data_channels.len(), 1);
                assert_eq!(data_channels[0].label, CHAT_DATA_CHANNEL_LABEL);
                assert!(data_channels[0].ordered);
                assert_eq!(app_metadata.space_uuid, "space:dm-1");
            }
            _ => panic!("expected sessionInvite"),
        }
    }

    #[test]
    fn av_call_transports_are_audio_and_video_without_data_channels() {
        assert_eq!(
            av_call_transports(),
            vec!["audio".to_owned(), "video".to_owned()]
        );
        assert!(av_call_data_channels().is_empty());
    }

    #[test]
    fn session_invite_wires_av_call_metadata() {
        let auth = chat::SessionJoinAuth {
            session_id: "wrtc:call-1".into(),
            authorized: true,
            purpose: PURPOSE_AV_CALL.into(),
            space_uuid: "space:dm-1".into(),
            participants: vec![
                AccountNumber::from("alice"),
                AccountNumber::from("bob"),
            ],
            lifecycle: 1,
            expires_at: 99,
            expired: false,
        };
        let frame = session_invite_frame(&auth, AccountNumber::from("alice"));
        match frame {
            ServerFrame::SessionInvite {
                app_service,
                purpose,
                transports,
                data_channels,
                app_metadata,
                ..
            } => {
                assert_eq!(app_service, APP_SERVICE_CHAT);
                assert_eq!(purpose, PURPOSE_AV_CALL);
                assert_eq!(transports, vec!["audio", "video"]);
                assert!(data_channels.is_empty());
                assert_eq!(app_metadata.space_uuid, "space:dm-1");
            }
            _ => panic!("expected sessionInvite"),
        }
    }

    #[test]
    fn session_invite_includes_all_n_party_participants() {
        let auth = chat::SessionJoinAuth {
            session_id: "wrtc:group-1".into(),
            authorized: true,
            purpose: PURPOSE_CHAT_DATA.into(),
            space_uuid: "space:group-1".into(),
            participants: vec![
                AccountNumber::from("alice"),
                AccountNumber::from("bob"),
                AccountNumber::from("carol"),
            ],
            lifecycle: 1,
            expires_at: 99,
            expired: false,
        };
        let frame = session_invite_frame(&auth, AccountNumber::from("alice"));
        match frame {
            ServerFrame::SessionInvite {
                participants,
                app_metadata,
                data_channels,
                ..
            } => {
                assert_eq!(participants.len(), 3);
                assert_eq!(app_metadata.space_uuid, "space:group-1");
                assert_eq!(data_channels[0].label, CHAT_DATA_CHANNEL_LABEL);
                assert!(data_channels[0].ordered);
            }
            _ => panic!("expected sessionInvite"),
        }
    }

    #[test]
    fn session_invite_includes_all_n_party_av_call_participants() {
        let auth = chat::SessionJoinAuth {
            session_id: "wrtc:group-call-1".into(),
            authorized: true,
            purpose: PURPOSE_AV_CALL.into(),
            space_uuid: "space:group-1".into(),
            participants: vec![
                AccountNumber::from("alice"),
                AccountNumber::from("bob"),
                AccountNumber::from("carol"),
            ],
            lifecycle: 1,
            expires_at: 99,
            expired: false,
        };
        let frame = session_invite_frame(&auth, AccountNumber::from("alice"));
        match frame {
            ServerFrame::SessionInvite {
                participants,
                purpose,
                transports,
                data_channels,
                app_metadata,
                ..
            } => {
                assert_eq!(participants.len(), 3);
                assert_eq!(purpose, PURPOSE_AV_CALL);
                assert_eq!(transports, vec!["audio", "video"]);
                assert!(data_channels.is_empty());
                assert_eq!(app_metadata.space_uuid, "space:group-1");
            }
            _ => panic!("expected sessionInvite"),
        }
    }
}
