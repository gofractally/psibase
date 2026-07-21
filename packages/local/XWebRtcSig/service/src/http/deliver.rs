use psibase::services::x_http::Wrapper as XHttp;
use psibase::{services::transact::Wrapper as Transact, AccountNumber, ServiceWrapper};

use crate::ice_config::merged_ice_servers;
use crate::protocol::{
    decode_server_frame_json, encode_server_frame, ProtocolError, ServerFrame, WEBSOCKET_TEXT,
};
use crate::signaling::tear_down_sessions_for_dead_socket_tx;
use crate::state::subjective::{
    disconnect_presence_fanout_tx, enqueue_pending_outbound_frames_tx, remove_socket_session_tx,
    sweep_all_known_sessions_tx, take_pending_outbound_payloads_tx,
};
use crate::trace::xrtcsig_trace;

/// Extra ICE JSON merged into welcome. Empty for now (default STUN only).
/// Placeholder for coming node-configured TURN.
pub(crate) fn turn_ice_servers_json() -> String {
    "[]".into()
}

#[cfg_attr(not(feature = "rt-trace"), allow(dead_code))]
pub(crate) fn server_frame_kind(frame: &ServerFrame) -> &'static str {
    match frame {
        ServerFrame::Welcome { .. } => "welcome",
        ServerFrame::Error { .. } => "error",
        ServerFrame::SessionInvite { .. } => "sessionInvite",
        ServerFrame::ParticipantJoined { .. } => "participantJoined",
        ServerFrame::ParticipantState { .. } => "participantState",
        ServerFrame::Signal { .. } => "signal",
        ServerFrame::SessionEnded { .. } => "sessionEnded",
        ServerFrame::Pong => "pong",
        ServerFrame::PresenceSnapshot { .. } => "presenceSnapshot",
        ServerFrame::Presence { .. } => "presence",
        ServerFrame::SessionSnapshot { .. } => "sessionSnapshot",
        ServerFrame::TransportLost { .. } => "transportLost",
    }
}

pub(crate) fn send_frame(socket: i32, frame: &ServerFrame) {
    let payload = encode_server_frame(frame).expect("server frame must serialize");
    xrtcsig_trace!(
        "[xrtcsig-trace] send sock={} kind={}\n",
        socket,
        server_frame_kind(frame),
    );
    XHttp::call().send(socket, payload.into_bytes(), WEBSOCKET_TEXT);
}

pub(crate) fn send_welcome(socket: i32, user: AccountNumber, server_time: i64, turn_json: &str) {
    let ice_servers = merged_ice_servers(turn_json);
    send_frame(
        socket,
        &ServerFrame::Welcome {
            user: user.into(),
            server_time,
            ice_servers,
            // Cold-start welcome leaves active_sessions unset.
            active_sessions: None,
        },
    );
}

pub(crate) fn send_protocol_error(socket: i32, err: ProtocolError) {
    send_frame(
        socket,
        &ServerFrame::Error {
            code: err.code().into(),
            reason: err.reason(),
            session_id: None,
        },
    );
}

pub(crate) fn enqueue_sweep_frames(now: i64) {
    let frames = sweep_all_known_sessions_tx(now);
    enqueue_peer_outbound_frames(now, frames);
}

/// Deliver any server frames queued for this socket on a prior recv where
/// inline peer fanout would have aborted the action.
pub(crate) fn flush_pending_outbound_for_socket(socket: i32) {
    for payload in take_pending_outbound_payloads_tx(socket) {
        let Ok(frame) = decode_server_frame_json(&payload) else {
            continue;
        };
        send_frame(socket, &frame);
    }
}

/// Send frames for the requesting socket immediately; queue peer targets so
/// a dead peer socket cannot abort before the joiner receives its response.
pub(crate) fn deliver_signaling_frames(
    requesting_socket: i32,
    frames: Vec<(i32, ServerFrame)>,
    now: i64,
) {
    let mut to_peers = Vec::new();
    for (target_socket, frame) in frames {
        if target_socket == requesting_socket {
            send_frame(requesting_socket, &frame);
        } else {
            to_peers.push((target_socket, frame));
        }
    }
    enqueue_peer_outbound_frames(now, to_peers);
}

pub(crate) fn enqueue_peer_outbound_frames(now: i64, frames: Vec<(i32, ServerFrame)>) {
    if frames.is_empty() {
        return;
    }
    enqueue_pending_outbound_frames_tx(frames, now);
}

pub(crate) fn handle_socket_cleanup(socket: i32) {
    let now = Transact::call().currentBlock().time.microseconds;
    // Drain ALL subjective state first (each call commits its own
    // subjective_tx). Doing all writes before any sends prevents zombie
    // rows from leaking into UserSessionTable / SocketSessionTable when a
    // later `send_frame` aborts on a peer socket whose tcp already died.
    let tear_down_frames = tear_down_sessions_for_dead_socket_tx(socket, now);
    let removed = remove_socket_session_tx(socket);
    let disconnect_fanout = removed
        .as_ref()
        .map(|r| disconnect_presence_fanout_tx(r.user, r.was_final_socket()));

    #[cfg(feature = "rt-trace")]
    {
        let teardown_targets: Vec<i32> = tear_down_frames.iter().map(|(s, _)| *s).collect();
        xrtcsig_trace!(
            "[xrtcsig-trace] cleanup-tear-down sock={} teardown_targets={:?}\n",
            socket,
            teardown_targets,
        );
    }
    for (peer_socket, frame) in tear_down_frames {
        send_frame(peer_socket, &frame);
    }

    let Some(removed) = removed else {
        xrtcsig_trace!("[xrtcsig-trace] cleanup-no-row sock={}\n", socket);
        return;
    };
    #[cfg(not(feature = "rt-trace"))]
    let _ = &removed;
    let Some(fanout) = disconnect_fanout else {
        return;
    };
    #[cfg(feature = "rt-trace")]
    {
        let disconnect_targets: Vec<i32> = fanout.peer_deltas.iter().map(|(s, _)| *s).collect();
        xrtcsig_trace!(
            "[xrtcsig-trace] cleanup-disconnect sock={} user={} final={} disconnect_targets={:?}\n",
            socket,
            removed.user,
            removed.was_final_socket(),
            disconnect_targets,
        );
    }
    for (peer_socket, frame) in fanout.peer_deltas {
        send_frame(peer_socket, &frame);
    }
}
