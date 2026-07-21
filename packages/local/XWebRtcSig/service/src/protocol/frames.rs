use psibase::ExactAccountNumber;
use serde::{Deserialize, Serialize};

use super::types::{
    ChatAppMetadata, ClientSupports, PeerPresence, DataChannelSpec, IceServerConfig,
    ParticipantStatePayload, PresenceStatus, SignalKind, WelcomeActiveSession,
};

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
        /// Active sessions on reconnect-welcome so the client can dispatch
        /// `recoverSession` directly. Omitted (`None`) on cold-start welcome.
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
    /// Roster snapshot emitted on `joinSession`: full participant set and
    /// session epoch for late joiners.
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
    /// Recoverable transport loss: peer websocket dropped while the on-chain
    /// session is still active. Clients should rejoin on reconnect.
    /// Distinct from `sessionEnded` (`leaveSession` / objective close).
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
        peers: Vec<PeerPresence>,
    },
    #[serde(rename = "presence")]
    Presence {
        account: ExactAccountNumber,
        status: PresenceStatus,
        #[serde(skip_serializing_if = "Option::is_none", rename = "socketCount")]
        socket_count: Option<u32>,
    },
}
