use crate::protocol::ServerFrame;
use crate::state::erase_sig_session_join;

use super::constants::query_session_auth;
use super::fanout::{fanout_participant_sockets, fanout_session_snapshot};

/// Subjective join teardown for a dead socket. Caller must already be in `subjective_tx!`.
///
/// Transport-level drops emit `TransportLost`, not `SessionEnded`. Clients treat
/// `SessionEnded` as fatal (FSM → `failed`, tear down every peer), but a single
/// participant's websocket dying is recoverable — the on-chain session remains
/// active and peers should keep other connections, disposing only the lost
/// participant. Re-establish via a fresh `joinSession` → `sessionSnapshot`.
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

        // Roster delta: remaining joined sockets see the dead participant
        // move from `joined` to `pending`.
        out.extend(fanout_session_snapshot(
            &join.session_id,
            &auth.participants,
        ));
    }
    out
}

fn tear_down_sessions_for_dead_socket_inner(dead_socket: i32, now: i64) -> Vec<(i32, ServerFrame)> {
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
pub fn tear_down_sessions_for_dead_socket(dead_socket: i32, now: i64) -> Vec<(i32, ServerFrame)> {
    tear_down_sessions_for_dead_socket_tx(dead_socket, now)
}
