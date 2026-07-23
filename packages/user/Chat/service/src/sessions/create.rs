use psibase::{AccountNumber, Table};

use crate::spaces::{canonical_space_members, ensure_sender_is_member, members_of};
use crate::tables::{
    Session, SessionParticipantRow, SessionParticipantTable, SessionRow, SessionTable,
};

use super::events::{append_session_event, close_session};
use super::lookup::{active_session_for_space, session_with_participants, unique_session_id_for};
use super::purpose::validate_purpose;
use super::types::{
    SessionError, DEFAULT_SESSION_TTL_US, PURPOSE_AV_CALL, SESSION_EVENT_CALL_STARTED,
    SESSION_STATUS_ACTIVE,
};

/// Create (or reuse) an active session for a Space.
/// Participants are always the full Space membership.
pub fn create_session(
    space_id: &str,
    purpose: &str,
    sender: AccountNumber,
    now: i64,
) -> Result<Session, SessionError> {
    validate_purpose(purpose)?;
    ensure_sender_is_member(space_id, sender)?;
    let participants = canonical_space_members(members_of(space_id));

    let mut session_created_at = now;
    if let Some(existing) = active_session_for_space(space_id, purpose) {
        if purpose == PURPOSE_AV_CALL {
            close_session(&existing.session_id, "superseded", sender, now)?;
            // Distinct objective session id when superseding within the same block time.
            session_created_at = now.saturating_add(1);
        } else {
            return Ok(session_with_participants(existing));
        }
    }

    let expires_at = now.saturating_add(DEFAULT_SESSION_TTL_US);
    let (session_id, session_created_at) = unique_session_id_for(
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
            SESSION_EVENT_CALL_STARTED,
            sender,
            "started",
            now,
        );
    }

    Ok(session_with_participants(row))
}
