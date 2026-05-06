use psibase::ExactAccountNumber;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;

pub const PSLACK_SUBPROTOCOL_V1: &str = "psibase.pslack.v1";
pub const PSLACK_SUBPROTOCOL_V2: &str = "psibase.pslack.v2";

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolError {
    MalformedJson(String),
    InvalidFrame(String),
    UnknownFrameType(String),
    ReservedSignal,
}

impl ProtocolError {
    /// Architecture §9: client framing and parsing issues use `bad-frame`.
    pub fn code(&self) -> &'static str {
        "bad-frame"
    }

    pub fn reason(&self) -> String {
        match self {
            Self::MalformedJson(reason)
            | Self::InvalidFrame(reason)
            | Self::UnknownFrameType(reason) => reason.clone(),
            Self::ReservedSignal => "signal frames are reserved for a future protocol phase".into(),
        }
    }
}

/// One entry in {@link ServerFrame::IceServers} (architecture §3.4).
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
#[serde(rename_all = "lowercase")]
pub enum CallTimelineEventKind {
    Started,
    Ended,
    Missed,
    Declined,
    Cancelled,
    Failed,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", deny_unknown_fields)]
pub enum ClientFrame {
    #[serde(rename = "sync")]
    Sync {
        #[serde(default, rename = "knownConversationIds")]
        known_conversation_ids: Vec<String>,
    },
    #[serde(rename = "openDm")]
    OpenDm { member: ExactAccountNumber },
    #[serde(rename = "openGroup")]
    OpenGroup {
        members: Vec<ExactAccountNumber>,
    },
    #[serde(rename = "say")]
    Say {
        #[serde(rename = "conversationId")]
        conversation_id: String,
        body: String,
        #[serde(rename = "clientMsgId")]
        client_msg_id: String,
    },
    #[serde(rename = "ack")]
    Ack {
        #[serde(rename = "conversationId")]
        conversation_id: String,
        #[serde(rename = "serverMsgId")]
        server_msg_id: u64,
    },
    #[serde(rename = "ping")]
    Ping,
    #[serde(rename = "signal")]
    Signal {
        #[serde(rename = "conversationId")]
        conversation_id: String,
        to: ExactAccountNumber,
        payload: Value,
    },
    #[serde(rename = "callInvite")]
    CallInvite {
        #[serde(rename = "conversationId")]
        conversation_id: String,
        #[serde(rename = "wantVideo")]
        want_video: bool,
        #[serde(rename = "wantAudio")]
        want_audio: bool,
        #[serde(rename = "clientCallId")]
        client_call_id: String,
    },
    #[serde(rename = "callAccept")]
    CallAccept {
        #[serde(rename = "callId")]
        call_id: String,
    },
    #[serde(rename = "callDecline")]
    CallDecline {
        #[serde(rename = "callId")]
        call_id: String,
        reason: Option<String>,
    },
    #[serde(rename = "callOffer")]
    CallOffer {
        #[serde(rename = "callId")]
        call_id: String,
        sdp: String,
    },
    #[serde(rename = "callAnswer")]
    CallAnswer {
        #[serde(rename = "callId")]
        call_id: String,
        sdp: String,
    },
    #[serde(rename = "callCandidate")]
    CallCandidate {
        #[serde(rename = "callId")]
        call_id: String,
        candidate: Option<String>,
        #[serde(rename = "sdpMid")]
        sdp_mid: Option<String>,
        #[serde(rename = "sdpMLineIndex")]
        sdp_mline_index: Option<u32>,
    },
    #[serde(rename = "callHangup")]
    CallHangup {
        #[serde(rename = "callId")]
        call_id: String,
        reason: Option<String>,
    },
}

impl ClientFrame {
    /// Optional context for `callError` replies (M1 stub).
    pub fn call_error_context(&self) -> (Option<String>, Option<String>) {
        match self {
            ClientFrame::CallInvite { conversation_id, .. } => {
                (None, Some(conversation_id.clone()))
            }
            ClientFrame::CallAccept { call_id }
            | ClientFrame::CallDecline { call_id, .. }
            | ClientFrame::CallOffer { call_id, .. }
            | ClientFrame::CallAnswer { call_id, .. }
            | ClientFrame::CallCandidate { call_id, .. }
            | ClientFrame::CallHangup { call_id, .. } => (Some(call_id.clone()), None),
            _ => (None, None),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", deny_unknown_fields)]
pub enum ServerFrame {
    #[serde(rename = "welcome")]
    Welcome {
        user: ExactAccountNumber,
        #[serde(rename = "serverTime")]
        server_time: i64,
    },
    #[serde(rename = "iceServers")]
    IceServers { servers: Vec<IceServerConfig> },
    #[serde(rename = "sync")]
    Sync {
        contacts: Vec<ContactPresence>,
        conversations: Vec<Conversation>,
    },
    #[serde(rename = "conversation")]
    Conversation {
        #[serde(rename = "conversationId")]
        conversation_id: String,
        kind: ConversationKind,
        members: Vec<ExactAccountNumber>,
    },
    #[serde(rename = "presence")]
    Presence {
        account: ExactAccountNumber,
        status: PresenceStatus,
        #[serde(skip_serializing_if = "Option::is_none", rename = "socketCount")]
        socket_count: Option<u32>,
    },
    #[serde(rename = "message")]
    Message {
        #[serde(rename = "conversationId")]
        conversation_id: String,
        from: ExactAccountNumber,
        body: String,
        #[serde(rename = "serverMsgId")]
        server_msg_id: u64,
        #[serde(rename = "serverTime")]
        server_time: i64,
        #[serde(skip_serializing_if = "Option::is_none", rename = "clientMsgId")]
        client_msg_id: Option<String>,
    },
    #[serde(rename = "delivered")]
    Delivered {
        #[serde(rename = "conversationId")]
        conversation_id: String,
        #[serde(rename = "serverMsgId")]
        server_msg_id: u64,
        to: ExactAccountNumber,
    },
    #[serde(rename = "error")]
    Error {
        code: String,
        reason: String,
        #[serde(skip_serializing_if = "Option::is_none", rename = "conversationId")]
        conversation_id: Option<String>,
    },
    #[serde(rename = "callError")]
    CallError {
        code: String,
        reason: String,
        #[serde(skip_serializing_if = "Option::is_none", rename = "callId")]
        call_id: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "conversationId")]
        conversation_id: Option<String>,
    },
    #[serde(rename = "callEvent")]
    CallEvent {
        #[serde(rename = "conversationId")]
        conversation_id: String,
        #[serde(skip_serializing_if = "Option::is_none", rename = "callId")]
        call_id: Option<String>,
        event: CallTimelineEventKind,
        #[serde(skip_serializing_if = "Option::is_none")]
        actor: Option<ExactAccountNumber>,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "durationMs")]
        duration_ms: Option<u64>,
        #[serde(rename = "serverMsgId")]
        server_msg_id: u64,
        #[serde(rename = "serverTime")]
        server_time: i64,
    },
    /// Routed signaling (parsed for tests / future handlers; M1 does not emit most of these).
    #[serde(rename = "callInvite")]
    SrvCallInvite {
        #[serde(rename = "callId")]
        call_id: String,
        #[serde(rename = "conversationId")]
        conversation_id: String,
        from: ExactAccountNumber,
        to: ExactAccountNumber,
        #[serde(rename = "wantVideo")]
        want_video: bool,
        #[serde(rename = "wantAudio")]
        want_audio: bool,
        #[serde(rename = "serverTime")]
        server_time: i64,
    },
    #[serde(rename = "callAccept")]
    SrvCallAccept {
        #[serde(rename = "callId")]
        call_id: String,
        by: ExactAccountNumber,
    },
    #[serde(rename = "callDecline")]
    SrvCallDecline {
        #[serde(rename = "callId")]
        call_id: String,
        by: ExactAccountNumber,
        reason: Option<String>,
    },
    #[serde(rename = "callOffer")]
    SrvCallOffer {
        #[serde(rename = "callId")]
        call_id: String,
        from: ExactAccountNumber,
        sdp: String,
    },
    #[serde(rename = "callAnswer")]
    SrvCallAnswer {
        #[serde(rename = "callId")]
        call_id: String,
        from: ExactAccountNumber,
        sdp: String,
    },
    #[serde(rename = "callCandidate")]
    SrvCallCandidate {
        #[serde(rename = "callId")]
        call_id: String,
        from: ExactAccountNumber,
        candidate: Option<String>,
        #[serde(rename = "sdpMid")]
        sdp_mid: Option<String>,
        #[serde(rename = "sdpMLineIndex")]
        sdp_mline_index: Option<u32>,
    },
    #[serde(rename = "callHangup")]
    SrvCallHangup {
        #[serde(rename = "callId")]
        call_id: String,
        by: ExactAccountNumber,
        reason: Option<String>,
    },
    #[serde(rename = "callTimeout")]
    CallTimeout {
        #[serde(rename = "callId")]
        call_id: String,
        #[serde(rename = "conversationId")]
        conversation_id: String,
        caller: ExactAccountNumber,
        callee: ExactAccountNumber,
    },
    #[serde(rename = "pong")]
    Pong,
}

/// STUN-only defaults (architecture §7.1): Google + Cloudflare.
pub fn default_stun_ice_servers_frame() -> ServerFrame {
    ServerFrame::IceServers {
        servers: vec![
            IceServerConfig {
                urls: IceServerUrls::One("stun:stun.l.google.com:19302".into()),
                username: None,
                credential: None,
            },
            IceServerConfig {
                urls: IceServerUrls::One("stun:stun.cloudflare.com:3478".into()),
                username: None,
                credential: None,
            },
        ],
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ContactPresence {
    pub account: ExactAccountNumber,
    pub presence: PresenceStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Conversation {
    pub conversation_id: String,
    pub kind: ConversationKind,
    pub members: Vec<ExactAccountNumber>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ConversationKind {
    Dm,
    Group,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PresenceStatus {
    Online,
    Offline,
}

pub fn parse_client_frame(input: &[u8]) -> Result<ClientFrame, ProtocolError> {
    let value: Value = serde_json::from_slice(input)
        .map_err(|err| ProtocolError::MalformedJson(err.to_string()))?;
    let frame_type = value
        .get("t")
        .and_then(Value::as_str)
        .ok_or_else(|| ProtocolError::InvalidFrame("frame discriminator `t` is required".into()))?;

    const KNOWN: &[&str] = &[
        "sync",
        "openDm",
        "openGroup",
        "say",
        "ack",
        "ping",
        "signal",
        "callInvite",
        "callAccept",
        "callDecline",
        "callOffer",
        "callAnswer",
        "callCandidate",
        "callHangup",
    ];
    if !KNOWN.iter().any(|k| *k == frame_type) {
        return Err(ProtocolError::UnknownFrameType(frame_type.into()));
    }

    serde_json::from_value(value).map_err(|err| ProtocolError::InvalidFrame(err.to_string()))
}

pub fn encode_server_frame(frame: &ServerFrame) -> Result<String, ProtocolError> {
    serde_json::to_string(frame).map_err(|err| ProtocolError::InvalidFrame(err.to_string()))
}

pub fn validate_client_frame(
    frame: &ClientFrame,
    current_user: ExactAccountNumber,
) -> Result<(), ProtocolError> {
    match frame {
        ClientFrame::Sync {
            known_conversation_ids,
        } => validate_ids(known_conversation_ids),
        ClientFrame::OpenDm { member } => validate_dm_member(*member, current_user),
        ClientFrame::OpenGroup { members } => {
            canonical_group_members(current_user, members).map(|_| ())
        }
        ClientFrame::Say {
            conversation_id,
            body,
            client_msg_id,
        } => {
            validate_required_id("conversationId", conversation_id)?;
            validate_required_id("body", body)?;
            validate_required_id("clientMsgId", client_msg_id)
        }
        ClientFrame::Ack {
            conversation_id, ..
        } => validate_required_id("conversationId", conversation_id),
        ClientFrame::Ping => Ok(()),
        ClientFrame::Signal { .. } => Err(ProtocolError::ReservedSignal),
        ClientFrame::CallInvite {
            conversation_id,
            client_call_id,
            ..
        } => {
            validate_required_id("conversationId", conversation_id)?;
            validate_required_id("clientCallId", client_call_id)
        }
        ClientFrame::CallAccept { call_id }
        | ClientFrame::CallDecline { call_id, .. }
        | ClientFrame::CallHangup { call_id, .. } => validate_required_id("callId", call_id),
        ClientFrame::CallOffer { call_id, sdp } | ClientFrame::CallAnswer { call_id, sdp } => {
            validate_required_id("callId", call_id)?;
            validate_required_id("sdp", sdp)
        }
        ClientFrame::CallCandidate { call_id, .. } => validate_required_id("callId", call_id),
    }
}

pub fn canonical_group_members(
    current_user: ExactAccountNumber,
    members: &[ExactAccountNumber],
) -> Result<Vec<ExactAccountNumber>, ProtocolError> {
    if members.len() < 2 {
        return Err(ProtocolError::InvalidFrame(
            "openGroup requires at least two other members".into(),
        ));
    }

    let mut seen = BTreeSet::new();
    seen.insert(current_user.value);
    let mut canonical = vec![current_user];

    for member in members {
        if *member == current_user {
            return Err(ProtocolError::InvalidFrame(
                "openGroup members must not include the current user".into(),
            ));
        }
        if !seen.insert(member.value) {
            return Err(ProtocolError::InvalidFrame(
                "openGroup members must be unique".into(),
            ));
        }
        canonical.push(*member);
    }

    canonical.sort_by_key(|member| member.value);
    Ok(canonical)
}

fn validate_dm_member(
    member: ExactAccountNumber,
    current_user: ExactAccountNumber,
) -> Result<(), ProtocolError> {
    if member == current_user {
        return Err(ProtocolError::InvalidFrame(
            "openDm member must be a different account".into(),
        ));
    }
    Ok(())
}

fn validate_ids(ids: &[String]) -> Result<(), ProtocolError> {
    for id in ids {
        validate_required_id("knownConversationIds", id)?;
    }
    Ok(())
}

fn validate_required_id(field: &str, value: &str) -> Result<(), ProtocolError> {
    if value.trim().is_empty() {
        return Err(ProtocolError::InvalidFrame(format!(
            "{field} must not be empty"
        )));
    }
    Ok(())
}
