use psibase::AccountNumber;

use crate::protocol::ServerFrame;

use super::constants::{
    query_session_auth, error_for_socket, EVENT_PARTICIPANT_LEFT, EVENT_SESSION_ENDED,
    EVENT_SESSION_FAILED, PURPOSE_AV_CALL,
};
use super::fanout::fanout_to_participant_sockets;
use crate::state::{clear_session_join, get_session_join, session_joins};

pub(super) fn leave_event_kind(
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

fn leave_session(
    socket: i32,
    user: AccountNumber,
    session_id: String,
    reason: Option<String>,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    let _ = now;
    let auth = query_session_auth(&session_id, user);
    if auth.purpose.is_empty() {
        return vec![error_for_socket(
            socket,
            "unknown-session",
            "unknown session",
            Some(session_id),
        )];
    }

    if get_session_join(&session_id, user).is_none() {
        return vec![error_for_socket(
            socket,
            "not-joined",
            "not joined to this session",
            Some(session_id),
        )];
    }

    clear_session_join(&session_id, user);
    let joined_before = session_joins(&session_id).len() + 1;
    let reason_str = normalize_leave_reason(reason);

    let event_kind = leave_event_kind(
        &auth.purpose,
        auth.participants.len(),
        &reason_str,
        joined_before,
    );
    crate::cleanup::session_purge_if_fully_ended(&session_id, event_kind);

    let ended = ServerFrame::SessionEnded {
        session_id: session_id.clone(),
        by: user.into(),
        reason: reason_str.clone(),
    };
    let mut out = fanout_to_participant_sockets(&auth.participants, Some(user), &ended);
    out.push((socket, ended));
    out
}

pub fn handle_leave_session(
    socket: i32,
    user: AccountNumber,
    session_id: String,
    reason: Option<String>,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    ::psibase::subjective_tx! {
        leave_session(socket, user, session_id.clone(), reason.clone(), now)
    }
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
            return vec![error_for_socket(
                socket,
                "not-participant",
                "not authorized in this session",
                Some(session_id),
            )];
        }
        if get_session_join(&session_id, user).is_none() {
            return vec![error_for_socket(
                socket,
                "not-joined",
                "join the session before sending participant state",
                Some(session_id),
            )];
        }

        let joins = session_joins(&session_id);
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
