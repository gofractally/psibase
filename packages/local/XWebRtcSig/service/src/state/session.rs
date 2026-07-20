use std::collections::BTreeSet;

use psibase::AccountNumber;
use psibase::Table;

use super::tables::{
    SigSessionJoinRow, SigSessionJoinTable, SigSessionTrackRow, SigSessionTrackTable,
};
use super::erase_pending_signals_for_session;

/// Client + server safety net: drop stale ringing av-call rows after this many µs.
pub const STALE_RINGING_TTL_US: i64 = 25_000_000;

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
        .get_index_pk()
        .iter()
        .filter(|row| row.socket == socket)
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
