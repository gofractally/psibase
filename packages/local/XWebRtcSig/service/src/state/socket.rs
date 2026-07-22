use psibase::AccountNumber;
use psibase::Table;

use super::tables::{SocketSessionRow, SocketSessionTable};
use super::{clear_pending_outbound, socket_clear_joins};
use crate::protocol::ClientSupports;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RemovedSocket {
    pub socket: i32,
    pub user: AccountNumber,
    pub remaining_sockets: Vec<i32>,
}

impl RemovedSocket {
    pub fn was_final_socket(&self) -> bool {
        self.remaining_sockets.is_empty()
    }
}

pub fn upsert_socket(socket: i32, user: AccountNumber, now: i64) {
    let socket_table = SocketSessionTable::new();
    socket_table
        .put(&SocketSessionRow {
            socket,
            user,
            connected_at: now,
            last_seen_at: now,
            client_instance_id: String::new(),
            active: false,
            visible: false,
            supports_audio: false,
            supports_video: false,
            supports_data: false,
        })
        .unwrap();
}

pub fn apply_client_ready(
    socket: i32,
    now: i64,
    client_instance_id: &str,
    active: bool,
    visible: bool,
    supports: &ClientSupports,
) -> bool {
    let socket_table = SocketSessionTable::new();
    let Some(mut row) = socket_table.get_index_pk().get(&socket) else {
        return false;
    };
    row.last_seen_at = now;
    row.client_instance_id = client_instance_id.to_string();
    row.active = active;
    row.visible = visible;
    row.supports_audio = supports.audio;
    row.supports_video = supports.video;
    row.supports_data = supports.data;
    socket_table.put(&row).unwrap();
    true
}

pub fn user_sockets(user: AccountNumber) -> Vec<i32> {
    let lo = (user, i32::MIN);
    let hi = (user, i32::MAX);
    SocketSessionTable::read()
        .get_index_by_user_socket()
        .range(lo..=hi)
        .map(|row| row.socket)
        .collect()
}

/// Sockets for `user` with a live `SocketSessionRow` (same as [`user_sockets`]
/// now that the user index is derived from that table).
pub fn user_live_sockets(user: AccountNumber) -> Vec<i32> {
    user_sockets(user)
}

/// Other accounts with at least one live websocket (excluding `user`).
pub fn other_connected_accounts(user: AccountNumber) -> Vec<AccountNumber> {
    let mut accounts: Vec<AccountNumber> = SocketSessionTable::read()
        .get_index_pk()
        .iter()
        .filter(|row| row.user != user)
        .map(|row| row.user)
        .collect();
    accounts.sort_by_key(|account| account.value);
    accounts.dedup_by_key(|account| account.value);
    accounts
}

pub fn get_socket(socket: i32) -> Option<SocketSessionRow> {
    SocketSessionTable::read().get_index_pk().get(&socket)
}

pub fn close_socket(socket: i32) -> Option<RemovedSocket> {
    socket_clear_joins(socket);
    clear_pending_outbound(socket);

    let socket_table = SocketSessionTable::new();
    let row = socket_table.get_index_pk().get(&socket)?;
    socket_table.erase(&socket);
    Some(RemovedSocket {
        socket,
        user: row.user,
        remaining_sockets: user_sockets(row.user),
    })
}
