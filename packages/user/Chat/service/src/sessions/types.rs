use crate::spaces::SpaceError;

pub const PURPOSE_CHAT_DATA: &str = "chat-data";
pub const PURPOSE_AV_CALL: &str = "av-call";

pub const SESSION_STATUS_ACTIVE: u8 = 1;
pub const SESSION_STATUS_ENDED: u8 = 2;
pub const SESSION_STATUS_FAILED: u8 = 3;

/// Stored on `SessionEventRow.kind` and returned on `CallEvent.kind` (one encoding).
pub const SESSION_EVENT_PARTICIPANT_JOINED: u8 = 1;
pub const SESSION_EVENT_PARTICIPANT_LEFT: u8 = 2;
pub const SESSION_EVENT_SESSION_FAILED: u8 = 3;
pub const SESSION_EVENT_SESSION_ENDED: u8 = 4;
pub const SESSION_EVENT_CALL_STARTED: u8 = 5;

/// Default objective session TTL (24 hours).
pub const DEFAULT_SESSION_TTL_US: i64 = 86_400_000_000;

#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum SessionError {
    #[error("{0}")]
    InvalidPurpose(String),
    #[error("{0}")]
    UnknownSpace(String),
    #[error("{0}")]
    NotParticipant(String),
    #[error("{0}")]
    InvalidParticipants(String),
    #[error("{0}")]
    UnknownSession(String),
    #[error("{0}")]
    SessionNotActive(String),
    #[error("{0}")]
    UnsupportedEventKind(String),
}

impl From<SpaceError> for SessionError {
    fn from(err: SpaceError) -> Self {
        match err {
            SpaceError::UnknownSpace(msg) => SessionError::UnknownSpace(msg),
            SpaceError::NotMember(msg) => SessionError::NotParticipant(msg),
            SpaceError::InvalidMemberSet(msg) => SessionError::InvalidParticipants(msg),
        }
    }
}
