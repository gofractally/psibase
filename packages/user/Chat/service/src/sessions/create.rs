use psibase::{AccountNumber, Table};

use crate::spaces::{
    canonical_space_members, ensure_sender_is_member, members_of, space_exists, space_row,
};
use crate::tables::{
    Session, SessionParticipantRow, SessionParticipantTable, SessionRow, SessionTable,
};

use super::events::{append_session_event, close_session};
use super::lookup::{
    active_session_for_space, allocate_unique_session_id, session_to_view,
};
use super::purpose::{participants_for_session, validate_purpose, validate_session_participants};
use super::types::{SessionError, DEFAULT_SESSION_TTL_US, PURPOSE_AV_CALL, SESSION_STATUS_ACTIVE};

pub fn create_session(
    space_id: &str,
    purpose: &str,
    participants: Vec<AccountNumber>,
    sender: AccountNumber,
    now: i64,
) -> Result<Session, SessionError> {
    validate_purpose(purpose)?;
    if !space_exists(space_id) {
        return Err(SessionError::UnknownSpace(format!(
            "unknown space {space_id}"
        )));
    }
    ensure_sender_is_member(space_id, sender)?;
    let space_row = space_row(space_id)
        .ok_or_else(|| SessionError::UnknownSpace(format!("unknown space {space_id}")))?;
    let space_members = canonical_space_members(members_of(space_id));
    let resolved = participants_for_session(space_row.kind, purpose, &space_members, &participants);
    let participants = validate_session_participants(sender, &space_members, &resolved)?;

    let mut session_created_at = now;
    if let Some(existing) = active_session_for_space(space_id, purpose) {
        if purpose == PURPOSE_AV_CALL {
            close_session(&existing.session_id, "superseded", sender, now)?;
            // Distinct objective session id when superseding within the same block time.
            session_created_at = now.saturating_add(1);
        } else {
            return Ok(session_to_view(existing));
        }
    }

    let expires_at = now.saturating_add(DEFAULT_SESSION_TTL_US);
    let (session_id, session_created_at) = allocate_unique_session_id(
        space_id,
        purpose,
        &participants,
        session_created_at,
        sender,
    );
    let row = SessionRow {
        session_id: session_id.clone(),
        space_id: space_id.to_owned(),
        purpose: purpose.to_owned(),
        status: SESSION_STATUS_ACTIVE,
        created_at: session_created_at,
        expires_at,
        created_by: sender,
    };
    SessionTable::new().put(&row).unwrap();

    let participant_table = SessionParticipantTable::new();
    for participant in participants {
        participant_table
            .put(&SessionParticipantRow {
                session_id: session_id.clone(),
                participant,
            })
            .unwrap();
    }

    if purpose == PURPOSE_AV_CALL {
        append_session_event(
            &session_id,
            crate::call_timeline::SESSION_EVENT_CALL_STARTED,
            sender,
            "started",
            now,
        );
    }

    Ok(session_to_view(row))
}
