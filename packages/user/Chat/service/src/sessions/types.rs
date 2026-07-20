use psibase::AccountNumber;

use crate::spaces::SpaceError;

pub const PURPOSE_CHAT_DATA: &str = "chat-data";
pub const PURPOSE_AV_CALL: &str = "av-call";
/// Pair-only transport sessions (`wrtc:pair:lower:higher`) — no objective Space row.
pub const PAIR_SESSION_PREFIX: &str = "wrtc:pair:";

pub const SESSION_STATUS_ACTIVE: u8 = 1;
pub const SESSION_STATUS_ENDED: u8 = 2;
pub const SESSION_STATUS_FAILED: u8 = 3;

pub const SESSION_EVENT_PARTICIPANT_JOINED: u8 = 1;
pub const SESSION_EVENT_PARTICIPANT_LEFT: u8 = 2;
pub const SESSION_EVENT_SESSION_FAILED: u8 = 3;
pub const SESSION_EVENT_SESSION_ENDED: u8 = 4;

/// Default objective session TTL (24 hours).
pub const DEFAULT_SESSION_TTL_US: i64 = 86_400_000_000;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SessionError {
    InvalidPurpose(String),
    UnknownSpace(String),
    NotMember(String),
    InvalidParticipants(String),
    UnknownSession(String),
    SessionNotActive(String),
    UnauthorizedCaller(String),
}

impl From<SpaceError> for SessionError {
    fn from(err: SpaceError) -> Self {
        match err {
            SpaceError::UnknownSpace(msg) => SessionError::UnknownSpace(msg),
            SpaceError::NotMember(msg) => SessionError::NotMember(msg),
            SpaceError::InvalidMemberSet(msg) => SessionError::InvalidParticipants(msg),
        }
    }
}

impl SessionError {
    pub fn message(&self) -> String {
        match self {
            SessionError::InvalidPurpose(msg) => msg.clone(),
            SessionError::UnknownSpace(msg) => msg.clone(),
            SessionError::NotMember(msg) => msg.clone(),
            SessionError::InvalidParticipants(msg) => msg.clone(),
            SessionError::UnknownSession(msg) => msg.clone(),
            SessionError::SessionNotActive(msg) => msg.clone(),
            SessionError::UnauthorizedCaller(msg) => msg.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Session {
    pub session_id: String,
    pub space_uuid: String,
    pub purpose: String,
    pub participants: Vec<AccountNumber>,
    pub status: u8,
    pub expires_at: i64,
    pub created_at: i64,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WebRtcSessionEvent {
    pub session_id: String,
    pub kind: u8,
    pub account: AccountNumber,
    pub reason: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SessionJoinAuth {
    pub session_id: String,
    pub authorized: bool,
    pub purpose: String,
    pub space_uuid: String,
    pub participants: Vec<AccountNumber>,
    pub status: u8,
    pub expires_at: i64,
    pub expired: bool,
}
