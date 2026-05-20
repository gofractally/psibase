//! DM call lifecycle without WebRTC media (Milestone 2). Mutates subjective tables.

use std::cmp::Ordering;
use std::collections::BTreeSet;

use psibase::AccountNumber;
use psibase::ExactAccountNumber;
use psibase::Table;

use crate::protocol::{CallTimelineEventKind, ClientFrame, ServerFrame};
use crate::state::tables::{
    ActiveCallRow, ActiveCallTable, CallSocketBindingRow, CallSocketBindingTable,
    ConversationTable, UserActiveCallRow, UserActiveCallTable,
};
use crate::state::{
    active_call_for_user, allocate_call_id, cmp_call_invite_tuples, members_of, next_server_msg_id,
    sessions_for_user, stable_pick_callee_socket, CALL_PHASE_CONNECTED, CALL_PHASE_RINGING,
    CONVERSATION_KIND_DM, STALE_RINGING_TTL_US,
};

fn call_err_to(
    socket: i32,
    code: &str,
    reason: &str,
    call_id: Option<String>,
    conversation_id: Option<String>,
) -> (i32, ServerFrame) {
    (
        socket,
        ServerFrame::CallError {
            code: code.into(),
            reason: reason.into(),
            call_id,
            conversation_id,
        },
    )
}

fn new_call_event(
    conversation_id: &str,
    call_id: Option<&str>,
    event: CallTimelineEventKind,
    actor: Option<ExactAccountNumber>,
    reason: Option<String>,
    duration_ms: Option<u64>,
    now: i64,
) -> ServerFrame {
    ServerFrame::CallEvent {
        conversation_id: conversation_id.into(),
        call_id: call_id.map(|s| s.to_string()),
        event,
        actor,
        reason,
        duration_ms,
        server_msg_id: next_server_msg_id(),
        server_time: now,
    }
}

fn fanout_call_event(
    conversation_id: &str,
    evt: ServerFrame,
) -> Vec<(i32, ServerFrame)> {
    let members = members_of(conversation_id);
    let mut seen = BTreeSet::new();
    let mut out = Vec::new();
    for m in members {
        for s in sessions_for_user(m) {
            if seen.insert(s) {
                out.push((s, evt.clone()));
            }
        }
    }
    out
}

fn erase_full_call(row: &ActiveCallRow) {
    ActiveCallTable::new().erase(&row.call_id);
    UserActiveCallTable::new().erase(&row.caller);
    UserActiveCallTable::new().erase(&row.callee);
    CallSocketBindingTable::new().erase(&row.caller_socket);
    CallSocketBindingTable::new().erase(&row.callee_socket);
}

fn insert_call_state(row: &ActiveCallRow) {
    ActiveCallTable::new().put(row).unwrap();
    UserActiveCallTable::new()
        .put(&UserActiveCallRow {
            user: row.caller,
            call_id: row.call_id.clone(),
        })
        .unwrap();
    UserActiveCallTable::new()
        .put(&UserActiveCallRow {
            user: row.callee,
            call_id: row.call_id.clone(),
        })
        .unwrap();
    CallSocketBindingTable::new()
        .put(&CallSocketBindingRow {
            socket: row.caller_socket,
            call_id: row.call_id.clone(),
        })
        .unwrap();
    CallSocketBindingTable::new()
        .put(&CallSocketBindingRow {
            socket: row.callee_socket,
            call_id: row.call_id.clone(),
        })
        .unwrap();
}

pub fn sweep_stale_ringing_calls(now: i64) -> Vec<(i32, ServerFrame)> {
    ::psibase::subjective_tx! {
        let cutoff = now - STALE_RINGING_TTL_US;
        let stale: Vec<ActiveCallRow> = ActiveCallTable::read()
            .get_index_pk()
            .iter()
            .filter(|r| r.phase == CALL_PHASE_RINGING && r.last_activity_at < cutoff)
            .collect();

        let mut out = Vec::new();
        for row in stale {
            let ce = new_call_event(
                &row.conversation_id,
                Some(&row.call_id),
                CallTimelineEventKind::Missed,
                None,
                Some("timeout".into()),
                None,
                now,
            );
            out.extend(fanout_call_event(&row.conversation_id, ce));
            let caller_ex: ExactAccountNumber = row.caller.into();
            let timeout_fr = ServerFrame::CallTimeout {
                call_id: row.call_id.clone(),
                conversation_id: row.conversation_id.clone(),
                caller: caller_ex,
                callee: row.callee.into(),
            };
            let mut seen = BTreeSet::new();
            for s in sessions_for_user(row.caller)
                .into_iter()
                .chain(sessions_for_user(row.callee))
            {
                if seen.insert(s) {
                    out.push((s, timeout_fr.clone()));
                }
            }
            erase_full_call(&row);
        }
        out
    }
}

/// Called before removing a websocket session row so the callee socket is still resolvable.
pub fn tear_down_call_for_dead_socket(dead_socket: i32, now: i64) -> Vec<(i32, ServerFrame)> {
    ::psibase::subjective_tx! {
        let Some(bind) = CallSocketBindingTable::read().get_index_pk().get(&dead_socket) else {
            return vec![];
        };
        let Some(row) = ActiveCallTable::read().get_index_pk().get(&bind.call_id) else {
            CallSocketBindingTable::new().erase(&dead_socket);
            return vec![];
        };

        let peer_socket = if dead_socket == row.caller_socket {
            row.callee_socket
        } else {
            row.caller_socket
        };

        let mut out = Vec::new();
        out.push(call_err_to(
            peer_socket,
            "websocket-closed",
            "the other party disconnected",
            Some(row.call_id.clone()),
            Some(row.conversation_id.clone()),
        ));
        let ce = new_call_event(
            &row.conversation_id,
            Some(&row.call_id),
            CallTimelineEventKind::Failed,
            None,
            Some("transport".into()),
            None,
            now,
        );
        out.extend(fanout_call_event(&row.conversation_id, ce));
        erase_full_call(&row);
        out
    }
}

fn teardown_collision_superseded(row: &ActiveCallRow, now: i64) -> Vec<(i32, ServerFrame)> {
    let mut out = Vec::new();
    out.push(call_err_to(
        row.caller_socket,
        "collision-lost",
        "another call won the simultaneous initiation tie-break",
        Some(row.call_id.clone()),
        Some(row.conversation_id.clone()),
    ));
    let ce = new_call_event(
        &row.conversation_id,
        Some(&row.call_id),
        CallTimelineEventKind::Cancelled,
        Some(row.caller.into()),
        None,
        None,
        now,
    );
    out.extend(fanout_call_event(&row.conversation_id, ce));
    erase_full_call(row);
    out
}

fn handle_call_invite(
    socket: i32,
    caller: AccountNumber,
    conversation_id: String,
    want_video: bool,
    want_audio: bool,
    client_call_id: String,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    ::psibase::subjective_tx! {
        let conv_row = match ConversationTable::read().get_index_pk().get(&conversation_id) {
            Some(r) => r,
            None => {
                return vec![call_err_to(
                    socket,
                    "unknown-conversation",
                    "unknown conversation",
                    None,
                    Some(conversation_id),
                )];
            }
        };
        if conv_row.kind != CONVERSATION_KIND_DM {
            return vec![call_err_to(
                socket,
                "not-dm",
                "calls are only supported in two-person direct messages",
                None,
                Some(conversation_id),
            )];
        }
        let members = members_of(&conversation_id);
        if members.len() != 2 {
            return vec![call_err_to(
                socket,
                "not-dm",
                "calls require exactly two DM members",
                None,
                Some(conversation_id),
            )];
        }
        if !members.iter().any(|m| *m == caller) {
            return vec![call_err_to(
                socket,
                "not-member",
                "you are not a member of this conversation",
                None,
                Some(conversation_id),
            )];
        }
        let callee = *members.iter().find(|m| **m != caller).expect("dm");

        let uc = active_call_for_user(caller);
        let ud = active_call_for_user(callee);

        if let Some(ref row_c) = uc {
            if row_c.conversation_id != conversation_id {
                return vec![call_err_to(
                    socket,
                    "busy",
                    "already in another call",
                    None,
                    Some(conversation_id),
                )];
            }
            if row_c.caller == caller {
                return vec![call_err_to(
                    socket,
                    "busy",
                    "a call is already in progress for this conversation",
                    Some(row_c.call_id.clone()),
                    Some(conversation_id),
                )];
            }
            let ord = cmp_call_invite_tuples(
                row_c.caller,
                row_c.callee,
                row_c.created_at,
                caller,
                callee,
                now,
            );
            if ord != Ordering::Greater {
                return vec![call_err_to(
                    socket,
                    "collision-lost",
                    "another call won the simultaneous initiation tie-break",
                    None,
                    Some(conversation_id),
                )];
            }
            let mut out = teardown_collision_superseded(row_c, now);
            out.extend(begin_call_invite_after_checks(
                socket,
                caller,
                callee,
                conversation_id.as_str(),
                want_video,
                want_audio,
                client_call_id.as_str(),
                now,
            ));
            return out;
        }

        if let Some(ref row_d) = ud {
            if row_d.conversation_id != conversation_id {
                return vec![call_err_to(
                    socket,
                    "peer-busy",
                    "the other party is already in another call",
                    None,
                    Some(conversation_id),
                )];
            }
            return vec![call_err_to(
                socket,
                "peer-busy",
                "the other party is already in a call on this conversation",
                None,
                Some(conversation_id),
            )];
        }

        begin_call_invite_after_checks(
            socket,
            caller,
            callee,
            conversation_id.as_str(),
            want_video,
            want_audio,
            client_call_id.as_str(),
            now,
        )
    }
}

fn begin_call_invite_after_checks(
    socket: i32,
    caller: AccountNumber,
    callee: AccountNumber,
    conversation_id: &str,
    want_video: bool,
    want_audio: bool,
    client_call_id: &str,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    let callee_sock = match stable_pick_callee_socket(sessions_for_user(callee)) {
        Some(s) => s,
        None => {
            let mut out = Vec::new();
            out.push(call_err_to(
                socket,
                "peer-offline",
                "the other party is not connected",
                None,
                Some(conversation_id.into()),
            ));
            let ce = new_call_event(
                conversation_id,
                None,
                CallTimelineEventKind::Missed,
                None,
                Some("peer-offline".into()),
                None,
                now,
            );
            out.extend(fanout_call_event(conversation_id, ce));
            return out;
        }
    };

    let call_id = allocate_call_id(now, client_call_id, caller, callee);
    let row = ActiveCallRow {
        call_id: call_id.clone(),
        conversation_id: conversation_id.to_string(),
        caller,
        callee,
        caller_socket: socket,
        callee_socket: callee_sock,
        created_at: now,
        last_activity_at: now,
        phase: CALL_PHASE_RINGING,
        connected_at: 0,
    };
    insert_call_state(&row);
    let inv = ServerFrame::SrvCallInvite {
        call_id: call_id.clone(),
        conversation_id: conversation_id.to_string(),
        from: caller.into(),
        to: callee.into(),
        want_video,
        want_audio,
        server_time: now,
    };
    vec![(callee_sock, inv.clone()), (socket, inv)]
}

pub fn handle_call_accept(
    socket: i32,
    user: AccountNumber,
    call_id: String,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    ::psibase::subjective_tx! {
        let Some(row) = ActiveCallTable::read().get_index_pk().get(&call_id) else {
            return vec![call_err_to(
                socket,
                "bad-call",
                "unknown call",
                Some(call_id),
                None,
            )];
        };
        if row.callee != user {
            return vec![call_err_to(
                socket,
                "bad-call",
                "only the callee can accept this call",
                Some(call_id),
                Some(row.conversation_id.clone()),
            )];
        }
        if socket != row.callee_socket {
            return vec![call_err_to(
                socket,
                "bad-call",
                "signaling socket does not match the ring target",
                Some(call_id),
                Some(row.conversation_id.clone()),
            )];
        }
        if row.phase != CALL_PHASE_RINGING {
            return vec![call_err_to(
                socket,
                "bad-call",
                "call is not ringing",
                Some(call_id),
                Some(row.conversation_id.clone()),
            )];
        }

        let mut row = row;
        row.phase = CALL_PHASE_CONNECTED;
        row.connected_at = now;
        row.last_activity_at = now;
        ActiveCallTable::new().put(&row).unwrap();

        let mut out = Vec::new();
        let acc = ServerFrame::SrvCallAccept {
            call_id: call_id.clone(),
            by: user.into(),
        };
        out.push((row.caller_socket, acc.clone()));
        out.push((row.callee_socket, acc));

        let ce = new_call_event(
            &row.conversation_id,
            Some(&call_id),
            CallTimelineEventKind::Started,
            None,
            None,
            None,
            now,
        );
        out.extend(fanout_call_event(&row.conversation_id, ce));
        out
    }
}

pub fn handle_call_decline(
    socket: i32,
    user: AccountNumber,
    call_id: String,
    reason: Option<String>,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    ::psibase::subjective_tx! {
        let Some(row) = ActiveCallTable::read().get_index_pk().get(&call_id) else {
            return vec![call_err_to(
                socket,
                "bad-call",
                "unknown call",
                Some(call_id),
                None,
            )];
        };
        if row.callee != user {
            return vec![call_err_to(
                socket,
                "bad-call",
                "only the callee can decline this call",
                Some(call_id),
                Some(row.conversation_id.clone()),
            )];
        }
        if socket != row.callee_socket {
            return vec![call_err_to(
                socket,
                "bad-call",
                "signaling socket does not match the ring target",
                Some(call_id),
                Some(row.conversation_id.clone()),
            )];
        }
        if row.phase != CALL_PHASE_RINGING {
            return vec![call_err_to(
                socket,
                "bad-call",
                "call is not ringing",
                Some(call_id),
                Some(row.conversation_id.clone()),
            )];
        }

        let is_timeout = reason.as_deref() == Some("timeout");
        let (event, ev_reason, actor) = if is_timeout {
            (
                CallTimelineEventKind::Missed,
                Some("timeout".into()),
                None,
            )
        } else {
            (CallTimelineEventKind::Declined, None, Some(user.into()))
        };

        let ce = new_call_event(
            &row.conversation_id,
            Some(&call_id),
            event,
            actor,
            ev_reason,
            None,
            now,
        );
        let mut out = fanout_call_event(&row.conversation_id, ce);
        let decl = ServerFrame::SrvCallDecline {
            call_id: call_id.clone(),
            by: user.into(),
            reason: reason.clone(),
        };
        out.push((row.caller_socket, decl));
        erase_full_call(&row);
        out
    }
}

pub fn handle_call_hangup(
    socket: i32,
    user: AccountNumber,
    call_id: String,
    reason: Option<String>,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    ::psibase::subjective_tx! {
        let Some(row) = ActiveCallTable::read().get_index_pk().get(&call_id) else {
            return vec![call_err_to(
                socket,
                "bad-call",
                "unknown call",
                Some(call_id),
                None,
            )];
        };
        if user != row.caller && user != row.callee {
            return vec![call_err_to(
                socket,
                "bad-call",
                "not a participant in this call",
                Some(call_id),
                Some(row.conversation_id.clone()),
            )];
        }
        if socket != row.caller_socket && socket != row.callee_socket {
            return vec![call_err_to(
                socket,
                "bad-call",
                "signaling socket is not part of this call",
                Some(call_id),
                Some(row.conversation_id.clone()),
            )];
        }

        let mut out = Vec::new();
        let hangup_frame = ServerFrame::SrvCallHangup {
            call_id: call_id.clone(),
            by: user.into(),
            reason: reason.clone(),
        };
        out.push((row.caller_socket, hangup_frame.clone()));
        out.push((row.callee_socket, hangup_frame));

        if row.phase == CALL_PHASE_RINGING {
            if user == row.caller {
                let is_timeout = reason.as_deref() == Some("timeout");
                if is_timeout {
                    let ce = new_call_event(
                        &row.conversation_id,
                        Some(&call_id),
                        CallTimelineEventKind::Missed,
                        None,
                        Some("timeout".into()),
                        None,
                        now,
                    );
                    out.extend(fanout_call_event(&row.conversation_id, ce));
                    let caller_ex: ExactAccountNumber = row.caller.into();
                    let timeout_fr = ServerFrame::CallTimeout {
                        call_id: call_id.clone(),
                        conversation_id: row.conversation_id.clone(),
                        caller: caller_ex,
                        callee: row.callee.into(),
                    };
                    for s in sessions_for_user(row.callee) {
                        out.push((s, timeout_fr.clone()));
                    }
                } else {
                    let ce = new_call_event(
                        &row.conversation_id,
                        Some(&call_id),
                        CallTimelineEventKind::Cancelled,
                        Some(row.caller.into()),
                        None,
                        None,
                        now,
                    );
                    out.extend(fanout_call_event(&row.conversation_id, ce));
                }
            } else {
                let is_timeout = reason.as_deref() == Some("timeout");
                let (event, ev_reason, actor) = if is_timeout {
                    (
                        CallTimelineEventKind::Missed,
                        Some("timeout".into()),
                        None,
                    )
                } else {
                    (CallTimelineEventKind::Declined, None, Some(user.into()))
                };
                let ce = new_call_event(
                    &row.conversation_id,
                    Some(&call_id),
                    event,
                    actor,
                    ev_reason,
                    None,
                    now,
                );
                out.extend(fanout_call_event(&row.conversation_id, ce));
            }
        } else if reason.as_deref() == Some("ice-failed") {
            let ce = new_call_event(
                &row.conversation_id,
                Some(&call_id),
                CallTimelineEventKind::Failed,
                None,
                Some("ice-failed".into()),
                None,
                now,
            );
            out.extend(fanout_call_event(&row.conversation_id, ce));
        } else {
            let duration_ms = ((now - row.connected_at) / 1000).max(0) as u64;
            let ce = new_call_event(
                &row.conversation_id,
                Some(&call_id),
                CallTimelineEventKind::Ended,
                None,
                None,
                Some(duration_ms),
                now,
            );
            out.extend(fanout_call_event(&row.conversation_id, ce));
        }

        erase_full_call(&row);
        out
    }
}

fn route_connected_media_frame(
    socket: i32,
    user: AccountNumber,
    call_id: String,
    now: i64,
    outbound: ServerFrame,
) -> Vec<(i32, ServerFrame)> {
    ::psibase::subjective_tx! {
        let Some(row) = ActiveCallTable::read().get_index_pk().get(&call_id) else {
            return vec![call_err_to(
                socket,
                "bad-call",
                "unknown call",
                Some(call_id),
                None,
            )];
        };
        if row.phase != CALL_PHASE_CONNECTED {
            return vec![call_err_to(
                socket,
                "bad-call",
                "call is not connected",
                Some(call_id),
                Some(row.conversation_id.clone()),
            )];
        }
        let peer_socket = if user == row.caller && socket == row.caller_socket {
            row.callee_socket
        } else if user == row.callee && socket == row.callee_socket {
            row.caller_socket
        } else {
            return vec![call_err_to(
                socket,
                "bad-call",
                "signaling socket is not part of this call",
                Some(call_id),
                Some(row.conversation_id.clone()),
            )];
        };

        let mut row = row;
        row.last_activity_at = now;
        ActiveCallTable::new().put(&row).unwrap();

        vec![(peer_socket, outbound.clone())]
    }
}

pub fn handle_call_offer(
    socket: i32,
    user: AccountNumber,
    call_id: String,
    sdp: String,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    route_connected_media_frame(
        socket,
        user,
        call_id.clone(),
        now,
        ServerFrame::SrvCallOffer {
            call_id,
            from: user.into(),
            sdp,
        },
    )
}

pub fn handle_call_answer(
    socket: i32,
    user: AccountNumber,
    call_id: String,
    sdp: String,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    route_connected_media_frame(
        socket,
        user,
        call_id.clone(),
        now,
        ServerFrame::SrvCallAnswer {
            call_id,
            from: user.into(),
            sdp,
        },
    )
}

pub fn handle_call_candidate(
    socket: i32,
    user: AccountNumber,
    call_id: String,
    candidate: Option<String>,
    sdp_mid: Option<String>,
    sdp_mline_index: Option<u32>,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    route_connected_media_frame(
        socket,
        user,
        call_id.clone(),
        now,
        ServerFrame::SrvCallCandidate {
            call_id,
            from: user.into(),
            candidate,
            sdp_mid,
            sdp_mline_index,
        },
    )
}

pub fn handle_call_media_state(
    socket: i32,
    user: AccountNumber,
    call_id: String,
    audio_muted: bool,
    video_muted: bool,
    now: i64,
) -> Vec<(i32, ServerFrame)> {
    route_connected_media_frame(
        socket,
        user,
        call_id.clone(),
        now,
        ServerFrame::SrvCallMediaState {
            call_id,
            from: user.into(),
            audio_muted,
            video_muted,
        },
    )
}

pub fn dispatch_call_client_frame(
    socket: i32,
    user: AccountNumber,
    now: i64,
    frame: ClientFrame,
) -> Vec<(i32, ServerFrame)> {
    match frame {
        ClientFrame::CallInvite {
            conversation_id,
            want_video,
            want_audio,
            client_call_id,
        } => handle_call_invite(
            socket,
            user,
            conversation_id,
            want_video,
            want_audio,
            client_call_id,
            now,
        ),
        ClientFrame::CallAccept { call_id } => handle_call_accept(socket, user, call_id, now),
        ClientFrame::CallDecline { call_id, reason } => {
            handle_call_decline(socket, user, call_id, reason, now)
        }
        ClientFrame::CallHangup { call_id, reason } => {
            handle_call_hangup(socket, user, call_id, reason, now)
        }
        ClientFrame::CallOffer { call_id, sdp } => {
            handle_call_offer(socket, user, call_id, sdp, now)
        }
        ClientFrame::CallAnswer { call_id, sdp } => {
            handle_call_answer(socket, user, call_id, sdp, now)
        }
        ClientFrame::CallCandidate {
            call_id,
            candidate,
            sdp_mid,
            sdp_mline_index,
        } => handle_call_candidate(
            socket,
            user,
            call_id,
            candidate,
            sdp_mid,
            sdp_mline_index,
            now,
        ),
        ClientFrame::CallMediaState {
            call_id,
            audio_muted,
            video_muted,
        } => handle_call_media_state(socket, user, call_id, audio_muted, video_muted, now),
        _ => vec![],
    }
}