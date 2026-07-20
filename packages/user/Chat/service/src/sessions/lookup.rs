use psibase::{sha256, AccountNumber, Table};

use crate::tables::{SessionParticipantTable, SessionRow, SessionTable};

use super::types::{Session, SESSION_STATUS_ACTIVE};

pub fn allocate_session_id(
    space_uuid: &str,
    purpose: &str,
    participants: &[AccountNumber],
    created_at: i64,
    created_by: AccountNumber,
) -> String {
    let encoded_participants: Vec<String> = participants.iter().map(ToString::to_string).collect();
    let bytes = serde_json::to_vec(&(
        space_uuid,
        purpose,
        encoded_participants,
        created_at,
        created_by.value,
    ))
    .unwrap_or_default();
    format!("wrtc:{}", sha256(&bytes))
}

/// Objective session ids hash creation time; bump `created_at` until unused.
pub fn allocate_unique_session_id(
    space_uuid: &str,
    purpose: &str,
    participants: &[AccountNumber],
    mut created_at: i64,
    created_by: AccountNumber,
) -> (String, i64) {
    loop {
        let session_id =
            allocate_session_id(space_uuid, purpose, participants, created_at, created_by);
        if session_row(&session_id).is_none() {
            return (session_id, created_at);
        }
        created_at = created_at.saturating_add(1);
    }
}

pub fn session_row(session_id: &str) -> Option<SessionRow> {
    SessionTable::read()
        .get_index_pk()
        .get(&session_id.to_owned())
}

pub fn participants_of_session(session_id: &str) -> Vec<AccountNumber> {
    SessionParticipantTable::read()
        .get_index_pk()
        .iter()
        .filter(|row| row.session_id == session_id)
        .map(|row| row.participant)
        .collect()
}

pub fn session_is_expired(row: &SessionRow, now: i64) -> bool {
    row.expires_at > 0 && now >= row.expires_at
}

pub fn session_to_view(row: SessionRow) -> Session {
    let session_id = row.session_id.clone();
    Session {
        session_id: row.session_id,
        space_uuid: row.space_uuid,
        purpose: row.purpose,
        participants: participants_of_session(&session_id),
        status: row.status,
        expires_at: row.expires_at,
        created_at: row.created_at,
    }
}

pub fn active_session_for_space(space_uuid: &str, purpose: &str) -> Option<SessionRow> {
    sessions_for_space(space_uuid, purpose)
        .into_iter()
        .find(|row| row.status == SESSION_STATUS_ACTIVE)
}

pub fn sessions_for_space(space_uuid: &str, purpose: &str) -> Vec<SessionRow> {
    SessionTable::read()
        .get_index_pk()
        .iter()
        .filter(|row| row.space_uuid == space_uuid && row.purpose == purpose)
        .collect()
}
