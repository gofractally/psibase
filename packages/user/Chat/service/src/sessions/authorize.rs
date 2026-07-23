use psibase::{AccountNumber, Table};

use crate::tables::{SessionJoinAuth, SessionParticipantTable};

use super::lookup::{participants_of_session, session_is_expired, session_row};
use super::pair::{authorize_pair_session_join, parse_pair_session_id};
use super::types::SESSION_STATUS_ACTIVE;

/// True if `account` may participate in this session id.
///
/// Objective sessions use `SessionParticipantTable`. Pair transport ids
/// (`wrtc:pair:lower:higher`, PR5+) authorize from the id itself — same rule as
/// [`authorize_session_join`].
pub fn is_session_participant(session_id: &str, account: AccountNumber) -> bool {
    if let Some(participants) = parse_pair_session_id(session_id) {
        return participants.iter().any(|p| *p == account);
    }
    SessionParticipantTable::read()
        .get_index_pk()
        .get(&(session_id.to_owned(), account))
        .is_some()
}

pub fn authorize_session_join(
    session_id: &str,
    account: AccountNumber,
    now: i64,
) -> SessionJoinAuth {
    if let Some(pair_auth) = authorize_pair_session_join(session_id, account) {
        return pair_auth;
    }

    let Some(row) = session_row(session_id) else {
        return SessionJoinAuth {
            session_id: session_id.to_owned(),
            authorized: false,
            purpose: String::new(),
            space_id: String::new(),
            participants: vec![],
            status: 0,
            expires_at: 0,
            expired: false,
        };
    };
    let participants = participants_of_session(session_id);
    let expired = session_is_expired(&row, now);
    let authorized = row.status == SESSION_STATUS_ACTIVE
        && !expired
        && is_session_participant(session_id, account);
    SessionJoinAuth {
        session_id: session_id.to_owned(),
        authorized,
        purpose: row.purpose,
        space_id: row.space_id,
        participants,
        status: row.status,
        expires_at: row.expires_at,
        expired,
    }
}
