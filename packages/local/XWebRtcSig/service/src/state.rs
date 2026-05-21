//! Subjective socket/session tables for `x-webrtcsig` (architecture §11.2–§11.3).

pub mod subjective;

use std::collections::BTreeSet;

use psibase::AccountNumber;
use psibase::Table;

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

    /// Live websocket join for an objective WebRTC session (architecture §11.3).
    #[table(name = "SigSessionJoinTable", index = 2, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct SigSessionJoinRow {
        pub session_id: String,
        pub account: AccountNumber,
        pub socket: i32,
        pub client_instance_id: String,
        pub joined_at: i64,
    }

    impl SigSessionJoinRow {
        #[primary_key]
        fn pk(&self) -> (String, AccountNumber) {
            (self.session_id.clone(), self.account)
        }

        #[secondary_key(1)]
        fn by_socket(&self) -> i32 {
            self.socket
        }
    }

    /// SDP/ICE queued when the recipient had no live websocket at signal time.
    #[table(name = "SigPendingSignalTable", index = 3, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct SigPendingSignalRow {
        pub session_id: String,
        pub to: AccountNumber,
        pub seq: i64,
        pub payload: String,
    }

    impl SigPendingSignalRow {
        #[primary_key]
        fn pk(&self) -> (String, AccountNumber, i64) {
            (self.session_id.clone(), self.to, self.seq)
        }
    }

    /// Last activity for stale ringing/session sweep (architecture §11.5).
    #[table(name = "SigSessionTrackTable", index = 4, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct SigSessionTrackRow {
        #[primary_key]
        pub session_id: String,
        pub ringing_since: i64,
        pub last_activity_at: i64,
    }

    /// Chat timeline events queued during websocket recv (objective writes deferred).
    #[table(name = "SigPendingWebRtcEventTable", index = 5, db = "Subjective")]
    #[derive(Debug, Clone, PartialEq, Eq, Fracpack, Serialize, Deserialize, ToSchema)]
    pub struct SigPendingWebRtcEventRow {
        pub session_id: String,
        pub seq: i64,
        pub kind: u8,
        pub account: AccountNumber,
        pub reason: String,
    }

    impl SigPendingWebRtcEventRow {
        #[primary_key]
        fn pk(&self) -> (String, i64) {
            (self.session_id.clone(), self.seq)
        }
    }
}

use tables::{
    SigPendingSignalRow, SigPendingSignalTable, SigPendingWebRtcEventRow,
    SigPendingWebRtcEventTable, SigSessionJoinRow, SigSessionJoinTable,
    SigSessionTrackRow, SigSessionTrackTable, SocketSessionRow, UserSessionTable,
};

/// Client + server safety net: drop stale ringing av-call rows after this many µs.
pub const STALE_RINGING_TTL_US: i64 = 25_000_000;

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

pub fn enqueue_pending_signal(
    session_id: &str,
    to: AccountNumber,
    seq: i64,
    payload: String,
) {
    // Block time microseconds collide for signals enqueued in the same block.
    // Push past the highest existing seq so the FIFO ordering of the queue
    // (offer → ICE candidates) survives `take_pending_signal_payloads`.
    let lo = (session_id.to_owned(), to, i64::MIN);
    let hi = (session_id.to_owned(), to, i64::MAX);
    let max_existing = SigPendingSignalTable::read()
        .get_index_pk()
        .range(lo..=hi)
        .map(|row| row.seq)
        .max();
    let next_seq = next_pending_signal_seq(max_existing, seq);
    SigPendingSignalTable::new()
        .put(&SigPendingSignalRow {
            session_id: session_id.to_owned(),
            to,
            seq: next_seq,
            payload,
        })
        .unwrap();
}

/// Pure seq bump for pending-signal FIFO when multiple signals share a block time.
pub fn next_pending_signal_seq(max_existing: Option<i64>, block_seq: i64) -> i64 {
    match max_existing {
        Some(prev) if prev >= block_seq => prev + 1,
        _ => block_seq,
    }
}

pub fn take_pending_signal_payloads(session_id: &str, to: AccountNumber) -> Vec<String> {
    let table = SigPendingSignalTable::new();
    let read = SigPendingSignalTable::read();
    let lo = (session_id.to_owned(), to, i64::MIN);
    let hi = (session_id.to_owned(), to, i64::MAX);
    let rows: Vec<SigPendingSignalRow> = read
        .get_index_pk()
        .range(lo..=hi)
        .collect();
    let mut payloads = Vec::with_capacity(rows.len());
    for row in rows {
        table.erase(&(row.session_id, row.to, row.seq));
        payloads.push(row.payload);
    }
    payloads
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

pub fn sig_join_row(session_id: &str, account: AccountNumber) -> Option<SigSessionJoinRow> {
    SigSessionJoinTable::read()
        .get_index_pk()
        .get(&(session_id.to_owned(), account))
}

pub fn sig_joins_for_session(session_id: &str) -> Vec<SigSessionJoinRow> {
    SigSessionJoinTable::read()
        .get_index_pk()
        .iter()
        .filter(|row| row.session_id == session_id)
        .collect()
}

pub fn sig_joins_for_socket(socket: i32) -> Vec<SigSessionJoinRow> {
    SigSessionJoinTable::read()
        .get_index_by_socket()
        .range(socket..=socket)
        .collect()
}

pub fn put_sig_session_join(row: &SigSessionJoinRow) {
    SigSessionJoinTable::new().put(row).unwrap();
}

pub fn erase_sig_session_join(session_id: &str, account: AccountNumber) {
    SigSessionJoinTable::new().erase(&(session_id.to_owned(), account));
}

pub fn erase_sig_joins_for_socket(socket: i32) {
    let joins = sig_joins_for_socket(socket);
    let table = SigSessionJoinTable::new();
    for row in joins {
        table.erase(&(row.session_id, row.account));
    }
}

pub fn touch_sig_session_track(session_id: &str, now: i64) {
    let table = SigSessionTrackTable::new();
    let row = table
        .get_index_pk()
        .get(&session_id.to_owned())
        .map(|mut existing| {
            existing.last_activity_at = now;
            existing
        })
        .unwrap_or(SigSessionTrackRow {
            session_id: session_id.to_owned(),
            ringing_since: now,
            last_activity_at: now,
        });
    table.put(&row).unwrap();
}

pub fn sig_session_track(session_id: &str) -> Option<SigSessionTrackRow> {
    SigSessionTrackTable::read()
        .get_index_pk()
        .get(&session_id.to_owned())
}

pub fn tracked_session_ids() -> Vec<String> {
    SigSessionTrackTable::read()
        .get_index_pk()
        .iter()
        .map(|row| row.session_id.clone())
        .collect()
}

pub fn erase_sig_session_track(session_id: &str) {
    SigSessionTrackTable::new().erase(&session_id.to_owned());
}

pub fn erase_pending_signals_for_session(session_id: &str) {
    let table = SigPendingSignalTable::new();
    let rows: Vec<SigPendingSignalRow> = SigPendingSignalTable::read()
        .get_index_pk()
        .iter()
        .filter(|row| row.session_id == session_id)
        .collect();
    for row in rows {
        table.erase(&(row.session_id, row.to, row.seq));
    }
}

pub fn enqueue_pending_webrtc_session_event(row: SigPendingWebRtcEventRow) {
    SigPendingWebRtcEventTable::new().put(&row).unwrap();
}

pub fn take_pending_webrtc_session_events() -> Vec<SigPendingWebRtcEventRow> {
    let rows: Vec<SigPendingWebRtcEventRow> = SigPendingWebRtcEventTable::read()
        .get_index_pk()
        .iter()
        .collect();
    let table = SigPendingWebRtcEventTable::new();
    for row in &rows {
        table.erase(&(row.session_id.clone(), row.seq));
    }
    rows
}

pub fn erase_sig_joins_for_session(session_id: &str) {
    let table = SigSessionJoinTable::new();
    for row in sig_joins_for_session(session_id) {
        table.erase(&(row.session_id, row.account));
    }
}

/// Drop all subjective signaling rows for a session (joins, pending signals, track).
pub fn cleanup_all_subjective_for_session(session_id: &str) {
    erase_sig_joins_for_session(session_id);
    erase_pending_signals_for_session(session_id);
    erase_sig_session_track(session_id);
}

pub fn joined_accounts_for_session(session_id: &str) -> Vec<AccountNumber> {
    sig_joins_for_session(session_id)
        .into_iter()
        .map(|row| row.account)
        .collect()
}

pub fn active_sig_session_ids() -> Vec<String> {
    let mut ids: BTreeSet<String> = tracked_session_ids().into_iter().collect();
    for join in SigSessionJoinTable::read().get_index_pk().iter() {
        ids.insert(join.session_id.clone());
    }
    ids.into_iter().collect()
}

pub fn remove_socket_session(socket: i32) -> Option<RemovedSocket> {
    erase_sig_joins_for_socket(socket);

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
    use super::{next_pending_signal_seq, RemovedSocket};
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

    #[test]
    fn next_pending_signal_seq_preserves_fifo_within_same_block() {
        assert_eq!(next_pending_signal_seq(None, 100), 100);
        assert_eq!(next_pending_signal_seq(Some(100), 100), 101);
        assert_eq!(next_pending_signal_seq(Some(105), 100), 106);
        assert_eq!(next_pending_signal_seq(Some(99), 100), 100);
    }
}
