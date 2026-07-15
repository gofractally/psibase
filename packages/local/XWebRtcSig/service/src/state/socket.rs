use psibase::AccountNumber;
use psibase::Table;

use super::tables::{self, SocketSessionRow, UserSessionTable};
use super::{erase_pending_outbound_for_socket, erase_sig_joins_for_socket};
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

pub fn upsert_socket_session(socket: i32, user: AccountNumber, now: i64) {
    let socket_table = tables::SocketSessionTable::new();
    let user_table = UserSessionTable::new();

    if let Some(existing) = socket_table.get_index_pk().get(&socket) {
        user_table.erase(&(existing.user, socket));
    }

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
    user_table.put(&tables::UserSessionRow { user, socket }).unwrap();
}

pub fn store_client_ready(
    socket: i32,
    now: i64,
    client_instance_id: &str,
    active: bool,
    visible: bool,
    supports: &ClientSupports,
) -> bool {
    let socket_table = tables::SocketSessionTable::new();
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

pub fn sessions_for_user(user: AccountNumber) -> Vec<i32> {
    UserSessionTable::read()
        .get_index_pk()
        .iter()
        .filter(|row| row.user == user)
        .map(|row| row.socket)
        .collect()
}

/// Sockets listed for `user` that still have an active `SocketSessionRow`.
pub fn live_sockets_for_user(user: AccountNumber) -> Vec<i32> {
    sessions_for_user(user)
        .into_iter()
        .filter(|socket| socket_session(*socket).is_some())
        .collect()
}

/// Other accounts with at least one live websocket (excluding `user`).
pub fn active_session_accounts_except(user: AccountNumber) -> Vec<AccountNumber> {
    let mut accounts: Vec<AccountNumber> = UserSessionTable::read()
        .get_index_pk()
        .iter()
        .filter(|row| row.user != user)
        .map(|row| row.user)
        .collect();
    accounts.sort_by_key(|account| account.value);
    accounts.dedup_by_key(|account| account.value);
    accounts
}

pub fn socket_session(socket: i32) -> Option<SocketSessionRow> {
    tables::SocketSessionTable::read()
        .get_index_pk()
        .get(&socket)
}

pub fn stable_pick_socket(mut sockets: Vec<i32>) -> Option<i32> {
    if sockets.is_empty() {
        return None;
    }
    sockets.sort_unstable();
    Some(sockets[0])
}

pub fn remove_socket_session(socket: i32) -> Option<RemovedSocket> {
    erase_sig_joins_for_socket(socket);
    erase_pending_outbound_for_socket(socket);

    let socket_table = tables::SocketSessionTable::new();
    let row = socket_table.get_index_pk().get(&socket)?;
    socket_table.erase(&socket);
    UserSessionTable::new().erase(&(row.user, socket));
    Some(RemovedSocket {
        socket,
        user: row.user,
        remaining_sockets: sessions_for_user(row.user),
    })
}
