use psibase::services::chat;
use psibase::{AccountNumber, Table};

use crate::protocol::ServerFrame;
use crate::state::{
    get_session_join, socket_joins,
    tables::{SessionJoinRow, SessionJoinTable},
    touch_session_liveness,
};

use super::constants::{is_supported_purpose, query_session_auth, error_for_socket};
use super::fanout::{
    build_session_snapshot, fanout_participant_joined, fanout_session_snapshot,
    fanout_to_participant_sockets, flush_pending_signals_to_socket,
};
use super::invite::session_invite_frame;

fn join_auth_errors(
    socket: i32,
    session_id: &str,
    auth: &chat::SessionJoinAuth,
) -> Option<Vec<(i32, ServerFrame)>> {
    if auth.purpose.is_empty() {
        return Some(vec![error_for_socket(
            socket,
            "unknown-session",
            "unknown session",
            Some(session_id.to_owned()),
        )]);
    }

    if auth.expired {
        return Some(vec![error_for_socket(
            socket,
            "session-expired",
            "session has expired",
            Some(session_id.to_owned()),
        )]);
    }

    if auth.status != 1 {
        return Some(vec![error_for_socket(
            socket,
            "session-not-active",
            "session is not active",
            Some(session_id.to_owned()),
        )]);
    }

    if !auth.authorized {
        return Some(vec![error_for_socket(
            socket,
            "not-participant",
            "account is not a participant in this session",
            Some(session_id.to_owned()),
        )]);
    }

    if !is_supported_purpose(&auth.purpose) {
        return Some(vec![error_for_socket(
            socket,
            "unsupported-purpose",
            "unsupported session purpose for signaling",
            Some(session_id.to_owned()),
        )]);
    }

    None
}

fn join_session(
    socket: i32,
    user: AccountNumber,
    session_id: String,
    client_instance_id: String,
    now: i64,
    auth: chat::SessionJoinAuth,
) -> Vec<(i32, ServerFrame)> {
    let prior = get_session_join(&session_id, user);
    let duplicate_same_socket = prior.as_ref().is_some_and(|row| row.socket == socket);
    SessionJoinTable::new()
        .put(&SessionJoinRow {
            session_id: session_id.clone(),
            account: user,
            socket,
            client_instance_id: client_instance_id.clone(),
            joined_at: now,
        })
        .unwrap();
    touch_session_liveness(&session_id, now);

    // Deliver any signals buffered while this user had no joined socket.
    let flushed = flush_pending_signals_to_socket(&session_id, user, socket);

    // Multi-pair mesh: one browser tab joins several pair sessions on the same
    // websocket. Multiple inline sends to the *joining* socket during a second
    // join abort the recv action and can kill the socket. Return only a
    // sessionSnapshot to the joiner, but still fan out invites/roster deltas to
    // other participants (e.g. group Meet after chat-data pair PCs are live).
    let socket_has_other_sessions = socket_joins(socket)
        .iter()
        .any(|row| row.session_id != session_id);
    if socket_has_other_sessions {
        let invite = session_invite_frame(&auth, user);
        let mut out = vec![(
            socket,
            build_session_snapshot(&session_id, &auth.participants),
        )];
        out.extend(flushed);
        if !duplicate_same_socket {
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
            out.extend(fanout_session_snapshot(&session_id, &auth.participants));
        }
        return out;
    }

    if duplicate_same_socket {
        // Re-send invite so clients can recover after duplicate joinSession (e.g. UI retries).
        let invite = session_invite_frame(&auth, user);
        let mut out = vec![(socket, invite)];
        out.extend(flushed);
        // Include the current snapshot so a retrying client sees the
        // same roster every other peer sees.
        out.push((
            socket,
            build_session_snapshot(&session_id, &auth.participants),
        ));
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

    // Every join is a roster delta. Broadcast the authoritative snapshot
    // to every joined socket (including the new joiner) so clients always
    // have ground truth — no inference from event sequences.
    out.extend(fanout_session_snapshot(&session_id, &auth.participants));

    out
}

fn join_session_tx(
    socket: i32,
    user: AccountNumber,
    session_id: String,
    client_instance_id: String,
    now: i64,
    auth: chat::SessionJoinAuth,
) -> Vec<(i32, ServerFrame)> {
    ::psibase::subjective_tx! {
        join_session(
            socket,
            user,
            session_id.clone(),
            client_instance_id.clone(),
            now,
            auth.clone(),
        )
    }
}

pub fn handle_join_session(
    socket: i32,
    user: AccountNumber,
    session_id: String,
    client_instance_id: String,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    let auth = query_session_auth(&session_id, user);
    if let Some(err) = join_auth_errors(socket, &session_id, &auth) {
        return err;
    }
    join_session_tx(socket, user, session_id, client_instance_id, now, auth)
}
