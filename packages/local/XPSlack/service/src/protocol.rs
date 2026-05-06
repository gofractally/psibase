use psibase::ExactAccountNumber;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeSet;

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
    #[serde(rename = "pong")]
    Pong,
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

    if !matches!(
        frame_type,
        "sync" | "openDm" | "openGroup" | "say" | "ack" | "ping" | "signal"
    ) {
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
