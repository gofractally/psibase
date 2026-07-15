use psibase::ExactAccountNumber;
use serde::{Deserialize, Serialize};

pub const REALTIME_SUBPROTOCOL_V1: &str = "psibase.realtime.v1";

/// WebSocket text frame flag passed to `x-http` `send` / `recv`.
pub const WEBSOCKET_TEXT: u32 = 1;
/// WebSocket binary frame flag passed to `x-http` `send` / `recv`.
pub const WEBSOCKET_BINARY: u32 = 2;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolError {
    MalformedJson(String),
    InvalidFrame(String),
    UnknownFrameType(String),
}

impl ProtocolError {
    pub fn code(&self) -> &'static str {
        "bad-frame"
    }

    pub fn reason(&self) -> String {
        match self {
            Self::MalformedJson(reason)
            | Self::InvalidFrame(reason)
            | Self::UnknownFrameType(reason) => reason.clone(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct IceServerConfig {
    pub urls: IceServerUrls,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub username: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub credential: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum IceServerUrls {
    One(String),
    Many(Vec<String>),
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClientSupports {
    pub audio: bool,
    pub video: bool,
    pub data: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DataChannelSpec {
    pub label: String,
    pub ordered: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ChatAppMetadata {
    #[serde(rename = "spaceUuid")]
    pub space_uuid: String,
}

/// Active-session hint returned in `welcome` after reconnect.
/// Lets the client skip the per-space GraphQL `activeSession` poll.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WelcomeActiveSession {
    #[serde(rename = "sessionId")]
    pub session_id: String,
    pub purpose: String,
    #[serde(rename = "spaceUuid")]
    pub space_uuid: String,
    pub participants: Vec<ExactAccountNumber>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub epoch: Option<u64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SignalKind {
    Offer,
    Answer,
    Candidate,
    #[serde(rename = "end-of-candidates")]
    EndOfCandidates,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ParticipantStatePayload {
    #[serde(skip_serializing_if = "Option::is_none", rename = "audioMuted")]
    pub audio_muted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "videoMuted")]
    pub video_muted: Option<bool>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "dataReady")]
    pub data_ready: Option<bool>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContactPresence {
    pub account: ExactAccountNumber,
    pub presence: PresenceStatus,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PresenceStatus {
    Online,
    Offline,
}
