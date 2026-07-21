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
    enqueue_pending_outbound, remove_socket_session, socket_session, store_client_ready,
    take_pending_outbound_payloads, upsert_socket_session, RemovedSocket,
};

pub fn socket_session_tx(socket: i32) -> Option<SocketSessionRow> {
    ::psibase::subjective_tx! {
        socket_session(socket)
    }
}

pub fn upsert_socket_session_tx(socket: i32, user: AccountNumber, now: i64) {
    ::psibase::subjective_tx! {
        upsert_socket_session(socket, user, now);
    }
}

pub fn store_client_ready_tx(
    socket: i32,
    now: i64,
    client_instance_id: String,
    active: bool,
    visible: bool,
    supports: ClientSupports,
) -> bool {
    ::psibase::subjective_tx! {
        let ok = store_client_ready(
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

pub fn remove_socket_session_tx(socket: i32) -> Option<RemovedSocket> {
    ::psibase::subjective_tx! {
        let removed = remove_socket_session(socket);
        removed
    }
}

pub fn sweep_all_known_sessions_tx(now: i64) -> Vec<(i32, crate::protocol::ServerFrame)> {
    ::psibase::subjective_tx! {
        cleanup::sweep_all_known_sessions(now)
    }
}

pub fn take_pending_outbound_payloads_tx(target_socket: i32) -> Vec<String> {
    ::psibase::subjective_tx! {
        take_pending_outbound_payloads(target_socket)
    }
}

pub fn enqueue_pending_outbound_frames_tx(
    frames: Vec<(i32, crate::protocol::ServerFrame)>,
    now: i64,
) {
    use crate::protocol::encode_server_frame;
    ::psibase::subjective_tx! {
        for (target_socket, frame) in &frames {
            if let Ok(payload) = encode_server_frame(frame) {
                enqueue_pending_outbound(*target_socket, now, payload);
            }
        }
    }
}
