//! Subjective-transaction wrappers for socket/session table operations.

use psibase::AccountNumber;

use crate::cleanup;
use crate::presence::{
    connect_presence_fanout, disconnect_presence_fanout, ConnectPresenceFanout,
    DisconnectPresenceFanout,
};
use crate::protocol::ClientSupports;
use crate::state::tables::SocketSessionRow;
use crate::state::{
    apply_client_ready, close_socket, drain_pending_outbound, enqueue_pending_outbound, get_socket,
    upsert_socket, RemovedSocket,
};

pub fn get_socket_tx(socket: i32) -> Option<SocketSessionRow> {
    ::psibase::subjective_tx! {
        get_socket(socket)
    }
}

pub fn upsert_socket_tx(socket: i32, user: AccountNumber, now: i64) {
    ::psibase::subjective_tx! {
        upsert_socket(socket, user, now);
    }
}

pub fn apply_client_ready_tx(
    socket: i32,
    now: i64,
    client_instance_id: String,
    active: bool,
    visible: bool,
    supports: ClientSupports,
) -> bool {
    ::psibase::subjective_tx! {
        let ok = apply_client_ready(
            socket,
            now,
            &client_instance_id,
            active,
            visible,
            &supports,
        );
        ok
    }
}

pub fn connect_presence_fanout_tx(user: AccountNumber) -> ConnectPresenceFanout {
    ::psibase::subjective_tx! {
        let fanout = connect_presence_fanout(user);
        fanout
    }
}

pub fn disconnect_presence_fanout_tx(
    user: AccountNumber,
    was_final_socket: bool,
) -> DisconnectPresenceFanout {
    ::psibase::subjective_tx! {
        let fanout = disconnect_presence_fanout(user, was_final_socket);
        fanout
    }
}

pub fn close_socket_tx(socket: i32) -> Option<RemovedSocket> {
    ::psibase::subjective_tx! {
        let removed = close_socket(socket);
        removed
    }
}

pub fn sweep_all_known_sessions_tx(now: i64) -> Vec<(i32, crate::protocol::ServerFrame)> {
    ::psibase::subjective_tx! {
        cleanup::sweep_all_known_sessions(now)
    }
}

pub fn drain_pending_outbound_tx(target_socket: i32) -> Vec<String> {
    ::psibase::subjective_tx! {
        drain_pending_outbound(target_socket)
    }
}

pub fn enqueue_outbound_frames_tx(frames: Vec<(i32, crate::protocol::ServerFrame)>, now: i64) {
    use crate::protocol::encode_server_frame;
    ::psibase::subjective_tx! {
        for (target_socket, frame) in &frames {
            if let Ok(payload) = encode_server_frame(frame) {
                enqueue_pending_outbound(*target_socket, now, payload);
            }
        }
    }
}
