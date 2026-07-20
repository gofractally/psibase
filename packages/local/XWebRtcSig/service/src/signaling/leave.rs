use psibase::AccountNumber;

use crate::protocol::ServerFrame;

use super::constants::{query_session_auth, session_err, EVENT_PARTICIPANT_LEFT, EVENT_SESSION_ENDED, EVENT_SESSION_FAILED, PURPOSE_AV_CALL};
use super::fanout::fanout_participant_sockets;
use crate::state::{erase_sig_session_join, sig_join_row, sig_joins_for_session};

pub(super) fn leave_lifecycle_event_kind(
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

pub(super) fn normalize_leave_reason(reason: Option<String>) -> String {
    match reason.as_deref() {
        Some("invite-timeout") => "timeout".into(),
        Some(other) => other.into(),
        None => "user".into(),
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

pub fn handle_participant_state(
    socket: i32,
    user: AccountNumber,
    session_id: String,
    state: crate::protocol::ParticipantStatePayload,
) -> Vec<(i32, ServerFrame)> {
    ::psibase::subjective_tx! {
        let auth = query_session_auth(&session_id, user);
        if !auth.authorized || auth.expired || auth.status != 1 {
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
        let mut seen = std::collections::BTreeSet::new();
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
