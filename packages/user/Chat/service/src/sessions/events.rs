use psibase::{AccountNumber, Table};

use crate::tables::{SessionEventRow, SessionEventTable, SessionTable};

use super::authorize::is_session_participant;
use super::lookup::session_row;
use super::types::{
    SessionError, WebRtcSessionEvent, SESSION_EVENT_PARTICIPANT_JOINED,
    SESSION_EVENT_PARTICIPANT_LEFT, SESSION_EVENT_SESSION_ENDED, SESSION_EVENT_SESSION_FAILED,
    SESSION_STATUS_ACTIVE, SESSION_STATUS_ENDED, SESSION_STATUS_FAILED,
};

pub fn append_session_event(
    session_id: &str,
    kind: u8,
    account: AccountNumber,
    reason: &str,
    at: i64,
) {
    SessionEventTable::new()
        .put(&SessionEventRow {
            session_id: session_id.to_owned(),
            kind,
            account,
            reason: reason.to_owned(),
            at,
        })
        .unwrap();
}

fn session_event_exists(session_id: &str, kind: u8, account: AccountNumber) -> bool {
    SessionEventTable::read()
        .get_index_pk()
        .iter()
        .any(|row| row.session_id == session_id && row.kind == kind && row.account == account)
}

/// Participant-committed session event after x-wrtcsig join/leave (objective write).
pub fn commit_webrtc_session_event(
    session_id: &str,
    kind: u8,
    account: AccountNumber,
    reason: &str,
    now: i64,
) -> Result<(), SessionError> {
    if !is_session_participant(session_id, account) {
        return Err(SessionError::NotMember(format!(
            "account is not a participant in session {session_id}"
        )));
    }

    let row = session_row(session_id)
        .ok_or_else(|| SessionError::UnknownSession(format!("unknown session {session_id}")))?;
    if row.status != SESSION_STATUS_ACTIVE {
        return Err(SessionError::SessionNotActive(format!(
            "session {session_id} is not active"
        )));
    }

    match kind {
        SESSION_EVENT_PARTICIPANT_JOINED | SESSION_EVENT_PARTICIPANT_LEFT => {
            if session_event_exists(session_id, kind, account) {
                return Ok(());
            }
        }
        SESSION_EVENT_SESSION_FAILED | SESSION_EVENT_SESSION_ENDED => {}
        _ => {
            return Err(SessionError::InvalidPurpose(format!(
                "unsupported webrtc session event kind {kind}"
            )));
        }
    }

    apply_webrtc_session_event(
        WebRtcSessionEvent {
            session_id: session_id.to_owned(),
            kind,
            account,
            reason: reason.to_owned(),
        },
        now,
    )
}

pub fn apply_webrtc_session_event(event: WebRtcSessionEvent, now: i64) -> Result<(), SessionError> {
    let row = session_row(&event.session_id).ok_or_else(|| {
        SessionError::UnknownSession(format!("unknown session {}", event.session_id))
    })?;
    if row.status != SESSION_STATUS_ACTIVE {
        return Err(SessionError::SessionNotActive(format!(
            "session {} is not active",
            event.session_id
        )));
    }

    append_session_event(
        &event.session_id,
        event.kind,
        event.account,
        &event.reason,
        now,
    );

    let mut updated = row;
    match event.kind {
        SESSION_EVENT_SESSION_FAILED => {
            updated.status = SESSION_STATUS_FAILED;
        }
        SESSION_EVENT_SESSION_ENDED => {
            updated.status = SESSION_STATUS_ENDED;
        }
        _ => {}
    }
    if updated.status != SESSION_STATUS_ACTIVE {
        SessionTable::new().put(&updated).unwrap();
    }

    Ok(())
}

pub fn close_session(
    session_id: &str,
    reason: &str,
    sender: AccountNumber,
    now: i64,
) -> Result<(), SessionError> {
    let row = session_row(session_id)
        .ok_or_else(|| SessionError::UnknownSession(format!("unknown session {session_id}")))?;
    if !is_session_participant(session_id, sender) {
        return Err(SessionError::NotMember(format!(
            "account is not a participant in session {session_id}"
        )));
    }
    if row.status != SESSION_STATUS_ACTIVE {
        return Err(SessionError::SessionNotActive(format!(
            "session {session_id} is not active"
        )));
    }
    append_session_event(session_id, SESSION_EVENT_SESSION_ENDED, sender, reason, now);
    let mut updated = row;
    updated.status = SESSION_STATUS_ENDED;
    SessionTable::new().put(&updated).unwrap();
    Ok(())
}
