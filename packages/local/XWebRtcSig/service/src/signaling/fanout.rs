use std::collections::BTreeSet;

use psibase::{AccountNumber, ExactAccountNumber};

use crate::protocol::{decode_server_frame_json, encode_server_frame, ServerFrame};
use crate::state::{
    enqueue_pending_signal, live_sockets_for_user, sig_joins_for_session, take_pending_signal_payloads,
};

pub(super) fn fanout_to_participant_sockets(
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

pub(super) fn fanout_participant_joined(
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

/// Ground-truth session roster broadcast.
///
/// Compute the current set of joined accounts for the session (deduplicated
/// across multiple sockets per account) and return a `sessionSnapshot`
/// frame ready to broadcast. Pending participants are the auth-list members
/// not currently joined. The epoch is `joined.len()` so clients can detect
/// changes monotonically even without comparing lists.
pub(super) fn build_session_snapshot(
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
pub(super) fn fanout_session_snapshot(
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
pub(super) fn fanout_signal_to_peer(
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

pub(super) fn redeliver_pending_signals(
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

pub(super) fn flush_pending_signals_to_socket(
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

pub(crate) fn fanout_session_ended_to_participants(
    participants: &[AccountNumber],
    frame: &ServerFrame,
) -> Vec<(i32, ServerFrame)> {
    fanout_to_participant_sockets(participants, None, frame)
}
