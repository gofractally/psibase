//! Websocket frames and ICE structs for `psibase.realtime.v1` (architecture §5.1).
//! ICE merge/validation helpers live in [`crate::ice_config`] (§11.4).

use psibase::ExactAccountNumber;
use serde::{Deserialize, Serialize};
use serde_json::Value;

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

/// Plan B #6 / B5 — active-session hint returned in `welcome` after a
/// reconnect. Lets the client skip the per-space GraphQL `activeSession` poll.
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

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", deny_unknown_fields)]
pub enum ClientFrame {
    #[serde(rename = "clientReady")]
    ClientReady {
        #[serde(rename = "clientInstanceId")]
        client_instance_id: String,
        active: bool,
        visible: bool,
        supports: ClientSupports,
    },
    #[serde(rename = "ping")]
    Ping,
    #[serde(rename = "joinSession")]
    JoinSession {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "clientInstanceId")]
        client_instance_id: String,
    },
    #[serde(rename = "signal")]
    Signal {
        #[serde(rename = "sessionId")]
        session_id: String,
        to: ExactAccountNumber,
        kind: SignalKind,
        #[serde(skip_serializing_if = "Option::is_none")]
        sdp: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        candidate: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "sdpMid")]
        sdp_mid: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "sdpMLineIndex")]
        sdp_mline_index: Option<u32>,
    },
    #[serde(rename = "leaveSession")]
    LeaveSession {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        reason: Option<String>,
    },
    #[serde(rename = "participantState")]
    ParticipantState {
        #[serde(rename = "sessionId")]
        session_id: String,
        state: ParticipantStatePayload,
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
        #[serde(rename = "iceServers")]
        ice_servers: Vec<IceServerConfig>,
        /// Plan B #6 — active sessions list returned on reconnect-welcome so
        /// the client can dispatch `recoverSession` events directly. None
        /// (omitted) for cold-start `welcome` frames.
        #[serde(
            skip_serializing_if = "Option::is_none",
            rename = "activeSessions"
        )]
        active_sessions: Option<Vec<WelcomeActiveSession>>,
    },
    #[serde(rename = "error")]
    Error {
        code: String,
        reason: String,
        #[serde(skip_serializing_if = "Option::is_none", rename = "sessionId")]
        session_id: Option<String>,
    },
    #[serde(rename = "sessionInvite")]
    SessionInvite {
        #[serde(rename = "sessionId")]
        session_id: String,
        #[serde(rename = "appService")]
        app_service: String,
        #[serde(rename = "appSessionId")]
        app_session_id: String,
        purpose: String,
        from: ExactAccountNumber,
        participants: Vec<ExactAccountNumber>,
        transports: Vec<String>,
        #[serde(rename = "dataChannels")]
        data_channels: Vec<DataChannelSpec>,
        #[serde(rename = "expiresAt")]
        expires_at: i64,
        #[serde(rename = "appMetadata")]
        app_metadata: ChatAppMetadata,
    },
    #[serde(rename = "participantJoined")]
    ParticipantJoined {
        #[serde(rename = "sessionId")]
        session_id: String,
        participant: ExactAccountNumber,
    },
    #[serde(rename = "participantState")]
    ParticipantState {
        #[serde(rename = "sessionId")]
        session_id: String,
        participant: ExactAccountNumber,
        state: ParticipantStatePayload,
    },
    #[serde(rename = "signal")]
    Signal {
        #[serde(rename = "sessionId")]
        session_id: String,
        from: ExactAccountNumber,
        to: ExactAccountNumber,
        kind: SignalKind,
        #[serde(skip_serializing_if = "Option::is_none")]
        sdp: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        candidate: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "sdpMid")]
        sdp_mid: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none", rename = "sdpMLineIndex")]
        sdp_mline_index: Option<u32>,
    },
    #[serde(rename = "sessionEnded")]
    SessionEnded {
        #[serde(rename = "sessionId")]
        session_id: String,
        by: ExactAccountNumber,
        reason: String,
    },
    /// Plan B #2 — roster snapshot emitted on `joinSession`. Lets late
    /// joiners know the full participant set + session epoch instead of
    /// inferring from history + presence + heuristics.
    #[serde(rename = "sessionSnapshot")]
    SessionSnapshot {
        #[serde(rename = "sessionId")]
        session_id: String,
        epoch: u64,
        #[serde(rename = "joinedParticipants")]
        joined_participants: Vec<ExactAccountNumber>,
        #[serde(rename = "pendingParticipants")]
        pending_participants: Vec<ExactAccountNumber>,
    },
    /// Plan B #3 — recoverable transport-loss frame. Emitted when a peer's
    /// websocket drops while the on-chain session is still active; clients
    /// should treat as transient and rejoin on reconnect. Compare with
    /// `sessionEnded` (reserved for `leaveSession` / objective close).
    #[serde(rename = "transportLost")]
    TransportLost {
        #[serde(rename = "sessionId")]
        session_id: String,
        participant: ExactAccountNumber,
    },
    #[serde(rename = "pong")]
    Pong,
    #[serde(rename = "presenceSnapshot")]
    PresenceSnapshot {
        contacts: Vec<ContactPresence>,
    },
    #[serde(rename = "presence")]
    Presence {
        account: ExactAccountNumber,
        status: PresenceStatus,
        #[serde(skip_serializing_if = "Option::is_none", rename = "socketCount")]
        socket_count: Option<u32>,
    },
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

pub fn parse_client_frame(input: &[u8]) -> Result<ClientFrame, ProtocolError> {
    let value: Value = serde_json::from_slice(input)
        .map_err(|err| ProtocolError::MalformedJson(err.to_string()))?;
    let frame_type = value
        .get("t")
        .and_then(Value::as_str)
        .ok_or_else(|| ProtocolError::InvalidFrame("frame discriminator `t` is required".into()))?;

    const KNOWN: &[&str] = &[
        "clientReady",
        "ping",
        "joinSession",
        "signal",
        "leaveSession",
        "participantState",
    ];
    if !KNOWN.iter().any(|k| *k == frame_type) {
        return Err(ProtocolError::UnknownFrameType(frame_type.into()));
    }

    serde_json::from_value(value).map_err(|err| ProtocolError::InvalidFrame(err.to_string()))
}

pub fn encode_server_frame(frame: &ServerFrame) -> Result<String, ProtocolError> {
    serde_json::to_string(frame).map_err(|err| ProtocolError::InvalidFrame(err.to_string()))
}

pub fn decode_server_frame_json(json: &str) -> Result<ServerFrame, ProtocolError> {
    serde_json::from_str(json).map_err(|err| ProtocolError::InvalidFrame(err.to_string()))
}

pub fn validate_client_frame(frame: &ClientFrame) -> Result<(), ProtocolError> {
    match frame {
        ClientFrame::ClientReady {
            client_instance_id, ..
        } => validate_required_id("clientInstanceId", client_instance_id),
        ClientFrame::Ping => Ok(()),
        ClientFrame::JoinSession {
            session_id,
            client_instance_id,
        } => {
            validate_required_id("sessionId", session_id)?;
            validate_required_id("clientInstanceId", client_instance_id)
        }
        ClientFrame::Signal {
            session_id,
            to: _,
            kind,
            sdp,
            candidate,
            sdp_mid,
            sdp_mline_index,
        } => {
            validate_required_id("sessionId", session_id)?;
            validate_signal_payload(*kind, sdp, candidate, sdp_mid, sdp_mline_index)
        }
        ClientFrame::LeaveSession { session_id, .. } => {
            validate_required_id("sessionId", session_id)
        }
        ClientFrame::ParticipantState { session_id, .. } => {
            validate_required_id("sessionId", session_id)
        }
    }
}

fn validate_signal_payload(
    kind: SignalKind,
    sdp: &Option<String>,
    candidate: &Option<String>,
    sdp_mid: &Option<String>,
    sdp_mline_index: &Option<u32>,
) -> Result<(), ProtocolError> {
    match kind {
        SignalKind::Offer | SignalKind::Answer => {
            if sdp.as_ref().map(|s| s.trim().is_empty()).unwrap_or(true) {
                return Err(ProtocolError::InvalidFrame(format!(
                    "signal kind {:?} requires non-empty sdp",
                    kind
                )));
            }
            Ok(())
        }
        SignalKind::Candidate => {
            if candidate.as_ref().map(|s| s.trim().is_empty()).unwrap_or(true) {
                return Err(ProtocolError::InvalidFrame(
                    "signal kind candidate requires candidate".into(),
                ));
            }
            Ok(())
        }
        SignalKind::EndOfCandidates => {
            if sdp.is_some() || candidate.is_some() || sdp_mid.is_some() || sdp_mline_index.is_some()
            {
                return Err(ProtocolError::InvalidFrame(
                    "signal kind end-of-candidates must not include sdp/candidate fields".into(),
                ));
            }
            Ok(())
        }
    }
}

fn validate_required_id(field: &str, value: &str) -> Result<(), ProtocolError> {
    if value.trim().is_empty() {
        return Err(ProtocolError::InvalidFrame(format!(
            "{field} must not be empty"
        )));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_client_ready_and_ping() {
        let ready = parse_client_frame(
            br#"{"t":"clientReady","clientInstanceId":"inst-1","active":true,"visible":false,"supports":{"audio":true,"video":false,"data":true}}"#,
        )
        .unwrap();
        assert_eq!(
            ready,
            ClientFrame::ClientReady {
                client_instance_id: "inst-1".into(),
                active: true,
                visible: false,
                supports: ClientSupports {
                    audio: true,
                    video: false,
                    data: true,
                },
            }
        );
        assert_eq!(parse_client_frame(br#"{"t":"ping"}"#).unwrap(), ClientFrame::Ping);
    }

    #[test]
    fn serializes_welcome_with_inline_ice_servers() {
        use crate::ice_config::default_stun_ice_server_configs;

        let frame = ServerFrame::Welcome {
            user: "alice".parse().unwrap(),
            server_time: 42,
            ice_servers: default_stun_ice_server_configs(),
            active_sessions: None,
        };
        let json = encode_server_frame(&frame).unwrap();
        assert!(json.contains(r#""t":"welcome""#));
        assert!(json.contains(r#""iceServers""#));
        assert!(json.contains(r#""serverTime":42"#));
        // active_sessions is None and skipped when serializing.
        assert!(!json.contains(r#""activeSessions""#));
    }

    #[test]
    fn serializes_welcome_with_active_sessions_hint() {
        use crate::ice_config::default_stun_ice_server_configs;

        let frame = ServerFrame::Welcome {
            user: "alice".parse().unwrap(),
            server_time: 42,
            ice_servers: default_stun_ice_server_configs(),
            active_sessions: Some(vec![WelcomeActiveSession {
                session_id: "wrtc:abc".into(),
                purpose: "av-call".into(),
                space_uuid: "space:1".into(),
                participants: vec!["alice".parse().unwrap(), "bob".parse().unwrap()],
                epoch: Some(3),
            }]),
        };
        let json = encode_server_frame(&frame).unwrap();
        assert!(json.contains(r#""activeSessions""#));
        assert!(json.contains(r#""sessionId":"wrtc:abc""#));
        assert!(json.contains(r#""epoch":3"#));
    }

    #[test]
    fn serializes_session_snapshot_frame() {
        let frame = ServerFrame::SessionSnapshot {
            session_id: "wrtc:abc".into(),
            epoch: 1,
            joined_participants: vec!["alice".parse().unwrap()],
            pending_participants: vec!["bob".parse().unwrap()],
        };
        let json = encode_server_frame(&frame).unwrap();
        assert!(json.contains(r#""t":"sessionSnapshot""#));
        assert!(json.contains(r#""epoch":1"#));
        assert!(json.contains(r#""joinedParticipants":["alice"]"#));
        assert!(json.contains(r#""pendingParticipants":["bob"]"#));
    }

    #[test]
    fn serializes_transport_lost_frame() {
        let frame = ServerFrame::TransportLost {
            session_id: "wrtc:abc".into(),
            participant: "bob".parse().unwrap(),
        };
        let json = encode_server_frame(&frame).unwrap();
        assert!(json.contains(r#""t":"transportLost""#));
        assert!(json.contains(r#""participant":"bob""#));
    }

    #[test]
    fn rejects_empty_client_instance_id() {
        let frame = parse_client_frame(
            br#"{"t":"clientReady","clientInstanceId":"  ","active":true,"visible":true,"supports":{"audio":true,"video":true,"data":false}}"#,
        )
        .unwrap();
        assert!(matches!(
            validate_client_frame(&frame),
            Err(ProtocolError::InvalidFrame(_))
        ));
    }

    #[test]
    fn rejects_malformed_json() {
        assert!(matches!(
            parse_client_frame(b"{not json"),
            Err(ProtocolError::MalformedJson(_))
        ));
    }

    #[test]
    fn rejects_missing_frame_discriminator() {
        assert!(matches!(
            parse_client_frame(br#"{"active":true}"#),
            Err(ProtocolError::InvalidFrame(_))
        ));
    }

    #[test]
    fn serializes_presence_snapshot_and_delta() {
        use super::{ContactPresence, PresenceStatus};

        let snapshot = ServerFrame::PresenceSnapshot {
            contacts: vec![ContactPresence {
                account: "bob".parse().unwrap(),
                presence: PresenceStatus::Online,
            }],
        };
        let json = encode_server_frame(&snapshot).unwrap();
        assert!(json.contains(r#""t":"presenceSnapshot""#));
        assert!(json.contains(r#""presence":"online""#));

        let delta = ServerFrame::Presence {
            account: "alice".parse().unwrap(),
            status: PresenceStatus::Online,
            socket_count: Some(2),
        };
        let json = encode_server_frame(&delta).unwrap();
        assert_eq!(
            json,
            r#"{"t":"presence","account":"alice","status":"online","socketCount":2}"#
        );
    }

    #[test]
    fn parses_join_session_and_signal_frames() {
        let join = parse_client_frame(
            br#"{"t":"joinSession","sessionId":"wrtc:abc","clientInstanceId":"inst-2"}"#,
        )
        .unwrap();
        assert!(matches!(join, ClientFrame::JoinSession { .. }));

        let signal = parse_client_frame(
            br#"{"t":"signal","sessionId":"wrtc:abc","to":"bob","kind":"offer","sdp":"v=0"}"#,
        )
        .unwrap();
        assert!(validate_client_frame(&signal).is_ok());
    }

    #[test]
    fn serializes_chat_data_session_invite() {
        let frame = ServerFrame::SessionInvite {
            session_id: "wrtc:abc".into(),
            app_service: "chat".into(),
            app_session_id: "space:1".into(),
            purpose: "chat-data".into(),
            from: "alice".parse().unwrap(),
            participants: vec!["alice".parse().unwrap(), "bob".parse().unwrap()],
            transports: vec![],
            data_channels: vec![DataChannelSpec {
                label: "chat".into(),
                ordered: true,
            }],
            expires_at: 42,
            app_metadata: ChatAppMetadata {
                space_uuid: "space:1".into(),
            },
        };
        let json = encode_server_frame(&frame).unwrap();
        assert!(json.contains(r#""t":"sessionInvite""#));
        assert!(json.contains(r#""appService":"chat""#));
        assert!(json.contains(r#""spaceUuid":"space:1""#));
        assert!(json.contains(r#""label":"chat""#));
    }

    #[test]
    fn structured_error_includes_session_id() {
        let frame = ServerFrame::Error {
            code: "not-participant".into(),
            reason: "account is not a participant in this session".into(),
            session_id: Some("wrtc:abc".into()),
        };
        let json = encode_server_frame(&frame).unwrap();
        assert!(json.contains(r#""sessionId":"wrtc:abc""#));
    }

    #[test]
    fn serializes_pair_session_invite_with_e2e_style_accounts() {
        let frame = ServerFrame::SessionInvite {
            session_id: "wrtc:pair:e2ealicegc:e2ecarolgc".into(),
            app_service: "chat".into(),
            app_session_id: String::new(),
            purpose: "chat-data".into(),
            from: "e2ealicegc".parse().unwrap(),
            participants: vec![
                "e2ealicegc".parse().unwrap(),
                "e2ecarolgc".parse().unwrap(),
            ],
            transports: vec![],
            data_channels: vec![DataChannelSpec {
                label: "chat".into(),
                ordered: true,
            }],
            expires_at: 0,
            app_metadata: ChatAppMetadata {
                space_uuid: String::new(),
            },
        };
        let json = encode_server_frame(&frame).unwrap();
        assert!(json.contains(r#""sessionId":"wrtc:pair:e2ealicegc:e2ecarolgc""#));
        assert!(json.contains(r#""e2ealicegc""#));
        assert!(json.contains(r#""e2ecarolgc""#));
    }

    #[test]
    fn rejects_chat_say_frame_as_unknown() {
        assert!(matches!(
            parse_client_frame(br#"{"t":"say","body":"secret"}"#),
            Err(ProtocolError::UnknownFrameType(_))
        ));
    }

    #[test]
    fn parses_leave_session_frame() {
        let frame = parse_client_frame(
            br#"{"t":"leaveSession","sessionId":"wrtc:abc","reason":"user"}"#,
        )
        .unwrap();
        assert!(validate_client_frame(&frame).is_ok());
        assert!(matches!(frame, ClientFrame::LeaveSession { .. }));
    }

    #[test]
    fn serializes_participant_joined_and_signal_frames() {
        let joined = ServerFrame::ParticipantJoined {
            session_id: "wrtc:abc".into(),
            participant: "bob".parse().unwrap(),
        };
        let joined_json = encode_server_frame(&joined).unwrap();
        assert!(joined_json.contains(r#""t":"participantJoined""#));
        assert!(joined_json.contains(r#""participant":"bob""#));

        let signal = ServerFrame::Signal {
            session_id: "wrtc:abc".into(),
            from: "alice".parse().unwrap(),
            to: "bob".parse().unwrap(),
            kind: SignalKind::Offer,
            sdp: Some("v=0".into()),
            candidate: None,
            sdp_mid: None,
            sdp_mline_index: None,
        };
        let signal_json = encode_server_frame(&signal).unwrap();
        assert!(signal_json.contains(r#""t":"signal""#));
        assert!(signal_json.contains(r#""kind":"offer""#));
    }

    #[test]
    fn rejects_chat_message_body_on_websocket() {
        assert!(matches!(
            parse_client_frame(
                br#"{"t":"chatMessage","spaceUuid":"space:1","from":"alice","body":"hi","sendTimestamp":1,"clientMsgId":"m1"}"#
            ),
            Err(ProtocolError::UnknownFrameType(_))
        ));
    }

    #[test]
    fn rejects_legacy_call_media_state_frame() {
        assert!(matches!(
            parse_client_frame(
                br#"{"t":"callMediaState","callId":"wrtc:abc","audioMuted":true,"videoMuted":false}"#
            ),
            Err(ProtocolError::UnknownFrameType(_))
        ));
    }
}
