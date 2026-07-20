use psibase::AccountNumber;

use crate::spaces::canonical_space_members;
use crate::tables::SPACE_KIND_GROUP;

use super::types::{SessionError, PURPOSE_AV_CALL, PURPOSE_CHAT_DATA};

pub fn is_valid_purpose(purpose: &str) -> bool {
    purpose == PURPOSE_CHAT_DATA || purpose == PURPOSE_AV_CALL
}

pub fn validate_purpose(purpose: &str) -> Result<(), SessionError> {
    if is_valid_purpose(purpose) {
        Ok(())
    } else {
        Err(SessionError::InvalidPurpose(format!(
            "unsupported session purpose: {purpose}"
        )))
    }
}

/// For group `chat-data` and `av-call` sessions, objective metadata always includes all
/// Space members (N-party mesh). DM and other purposes use the explicit participant list.
pub fn participants_for_session(
    space_kind: u8,
    purpose: &str,
    space_members: &[AccountNumber],
    explicit_participants: &[AccountNumber],
) -> Vec<AccountNumber> {
    if space_kind == SPACE_KIND_GROUP
        && (purpose == PURPOSE_CHAT_DATA || purpose == PURPOSE_AV_CALL)
    {
        canonical_space_members(space_members.iter().copied())
    } else {
        canonical_space_members(explicit_participants.iter().copied())
    }
}

/// Participants must be a non-empty subset of Space members; caller must be included.
pub fn validate_session_participants(
    sender: AccountNumber,
    space_members: &[AccountNumber],
    participants: &[AccountNumber],
) -> Result<Vec<AccountNumber>, SessionError> {
    let participants = canonical_space_members(participants.iter().copied());
    if participants.is_empty() {
        return Err(SessionError::InvalidParticipants(
            "session requires at least one participant".into(),
        ));
    }
    if !participants.iter().any(|p| *p == sender) {
        return Err(SessionError::InvalidParticipants(
            "caller must be included in session participants".into(),
        ));
    }
    for participant in &participants {
        if !space_members.iter().any(|m| m == participant) {
            return Err(SessionError::InvalidParticipants(format!(
                "participant {participant} is not a member of the space"
            )));
        }
    }
    Ok(participants)
}
