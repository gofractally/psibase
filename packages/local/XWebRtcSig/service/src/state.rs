//! Subjective socket/session tables for `x-webrtcsig` (architecture §11.2–§11.3).

use psibase::{AccountNumber, Table};

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

#[psibase::service_tables]
pub mod tables {
    use psibase::{AccountNumber, Fracpack, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "SocketSessionTable", index = 0, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct SocketSessionRow {
        #[primary_key]
        pub socket: i32,
        pub user: AccountNumber,
        pub connected_at: i64,
        pub last_seen_at: i64,
        pub client_instance_id: String,
        pub active: bool,
        pub visible: bool,
        pub supports_audio: bool,
        pub supports_video: bool,
        pub supports_data: bool,
    }

    impl SocketSessionRow {
        #[secondary_key(1)]
        fn by_user_socket(&self) -> (AccountNumber, i32) {
            (self.user, self.socket)
        }
    }

    #[table(name = "UserSessionTable", index = 1, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct UserSessionRow {
        pub user: AccountNumber,
        pub socket: i32,
    }

    impl UserSessionRow {
        #[primary_key]
        fn pk(&self) -> (AccountNumber, i32) {
            (self.user, self.socket)
        }
    }
}

use tables::{SocketSessionRow, UserSessionTable};

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

pub fn remove_socket_session(socket: i32) -> Option<RemovedSocket> {
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

#[cfg(test)]
mod tests {
    use super::RemovedSocket;
    use psibase::AccountNumber;

    #[test]
    fn removed_socket_final_when_no_remaining() {
        let user: AccountNumber = "alice".parse().unwrap();
        let removed = RemovedSocket {
            socket: 1,
            user,
            remaining_sockets: vec![],
        };
        assert!(removed.was_final_socket());
    }

    #[test]
    fn removed_socket_not_final_when_tabs_remain() {
        let user: AccountNumber = "alice".parse().unwrap();
        let removed = RemovedSocket {
            socket: 1,
            user,
            remaining_sockets: vec![2],
        };
        assert!(!removed.was_final_socket());
    }
}
