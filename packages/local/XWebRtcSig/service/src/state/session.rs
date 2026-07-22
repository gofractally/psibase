use std::collections::BTreeSet;

use psibase::AccountNumber;
use psibase::Table;

use super::tables::{
    SessionJoinRow, SessionJoinTable, SessionLivenessRow, SessionLivenessTable,
};
use super::session_clear_pending_signals;

/// Client + server safety net: drop stale ringing av-call rows after this many µs.
pub const STALE_RINGING_TTL_US: i64 = 25_000_000;

pub fn get_session_join(session_id: &str, account: AccountNumber) -> Option<SessionJoinRow> {
    SessionJoinTable::read()
        .get_index_pk()
        .get(&(session_id.to_owned(), account))
}

pub fn session_joins(session_id: &str) -> Vec<SessionJoinRow> {
    SessionJoinTable::read()
        .get_index_pk()
        .iter()
        .filter(|row| row.session_id == session_id)
        .collect()
}

pub fn socket_joins(socket: i32) -> Vec<SessionJoinRow> {
    SessionJoinTable::read()
        .get_index_pk()
        .iter()
        .filter(|row| row.socket == socket)
        .collect()
}

pub fn clear_session_join(session_id: &str, account: AccountNumber) {
    SessionJoinTable::new().erase(&(session_id.to_owned(), account));
}

pub fn socket_clear_joins(socket: i32) {
    let joins = socket_joins(socket);
    let table = SessionJoinTable::new();
    for row in joins {
        table.erase(&(row.session_id, row.account));
    }
}

pub fn touch_session_liveness(session_id: &str, now: i64) {
    let table = SessionLivenessTable::new();
    let row = table
        .get_index_pk()
        .get(&session_id.to_owned())
        .map(|mut existing| {
            existing.last_activity_at = now;
            existing
        })
        .unwrap_or(SessionLivenessRow {
            session_id: session_id.to_owned(),
            ringing_since: now,
            last_activity_at: now,
        });
    table.put(&row).unwrap();
}

pub fn get_session_liveness(session_id: &str) -> Option<SessionLivenessRow> {
    SessionLivenessTable::read()
        .get_index_pk()
        .get(&session_id.to_owned())
}

pub fn session_clear_joins(session_id: &str) {
    let table = SessionJoinTable::new();
    for row in session_joins(session_id) {
        table.erase(&(row.session_id, row.account));
    }
}

/// Drop all signaling rows for a session (joins, pending signals, track).
pub fn session_purge(session_id: &str) {
    session_clear_joins(session_id);
    session_clear_pending_signals(session_id);
    SessionLivenessTable::new().erase(&session_id.to_owned());
}

pub fn session_joined_accounts(session_id: &str) -> Vec<AccountNumber> {
    session_joins(session_id)
        .into_iter()
        .map(|row| row.account)
        .collect()
}

/// Session ids with a track row and/or at least one join (sweep candidates).
pub fn known_session_ids() -> Vec<String> {
    let mut ids: BTreeSet<String> = SessionLivenessTable::read()
        .get_index_pk()
        .iter()
        .map(|row| row.session_id.clone())
        .collect();
    for join in SessionJoinTable::read().get_index_pk().iter() {
        ids.insert(join.session_id.clone());
    }
    ids.into_iter().collect()
}
