use psibase::ExactAccountNumber;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const BATTLEZONE_SUBPROTOCOL_V1: &str = "psibase.battlezone.v1";
pub const WEBSOCKET_TEXT: u32 = 1;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ProtocolError {
    MalformedJson(String),
    InvalidFrame(String),
}

impl ProtocolError {
    pub fn code(&self) -> &'static str {
        "bad-frame"
    }

    pub fn reason(&self) -> String {
        match self {
            Self::MalformedJson(reason) | Self::InvalidFrame(reason) => reason.clone(),
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PresenceStatus {
    Online,
    Offline,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PeerPresence {
    pub account: ExactAccountNumber,
    pub presence: PresenceStatus,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RosterSlot {
    pub tank_id: String,
    pub controller: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub account: Option<ExactAccountNumber>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LobbyPlayer {
    pub account: ExactAccountNumber,
    pub ready: bool,
}

/// Frozen equal-value Banx stake for a pair of accounts.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BanxLockWire {
    pub a: ExactAccountNumber,
    pub b: ExactAccountNumber,
    pub a_pays: String,
    pub a_asset: u16,
    pub a_symbol: String,
    pub b_pays: String,
    pub b_asset: u16,
    pub b_symbol: String,
    pub a_min_return: String,
    pub b_min_return: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ClientFrame {
    #[serde(rename = "hello")]
    Hello,
    /// Mark ready in the waiting room. First ready player becomes lobby host
    /// and supplies enemyCount / slots for the pending match.
    #[serde(rename = "ready")]
    Ready {
        enemy_count: u8,
        /// Per enemy slot: "ai" or "human". Length should match enemy_count.
        #[serde(default)]
        slots: Vec<String>,
    },
    #[serde(rename = "unready")]
    Unready,
    #[serde(rename = "leaveMatch")]
    LeaveMatch,
    #[serde(rename = "input")]
    Input {
        tank_id: String,
        turn: f64,
        throttle: f64,
        fire: bool,
    },
    #[serde(rename = "stateSnapshot")]
    StateSnapshot { state: Value },
    /// Advertise local Banx stake proposal to peers.
    #[serde(rename = "banxStatus")]
    BanxStatus {
        on: bool,
        asset_id: u16,
        units: String,
        symbol: String,
    },
    /// Offer the lower-stake peer a bump to equal value.
    #[serde(rename = "banxOffer")]
    BanxOffer {
        to: ExactAccountNumber,
        required_units: String,
        required_asset: u16,
        required_symbol: String,
        match_peer_units: String,
        match_peer_asset: u16,
        match_peer_symbol: String,
        lock: BanxLockWire,
    },
    #[serde(rename = "banxOfferReply")]
    BanxOfferReply {
        to: ExactAccountNumber,
        accept: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        lock: Option<BanxLockWire>,
    },
    #[serde(rename = "banxLock")]
    BanxLock { lock: BanxLockWire },
    /// Host-only: a human-vs-human hit that should settle via Banx.
    #[serde(rename = "banxHit")]
    BanxHit {
        hit_id: u64,
        victim: ExactAccountNumber,
        shooter: ExactAccountNumber,
    },
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "t", rename_all = "camelCase", rename_all_fields = "camelCase")]
pub enum ServerFrame {
    #[serde(rename = "welcome")]
    Welcome {
        user: ExactAccountNumber,
        server_time: i64,
    },
    #[serde(rename = "presenceSnapshot")]
    PresenceSnapshot { peers: Vec<PeerPresence> },
    #[serde(rename = "presence")]
    Presence {
        account: ExactAccountNumber,
        status: PresenceStatus,
    },
    /// Waiting-room snapshot: who is live and who has pressed Enter.
    #[serde(rename = "lobby")]
    Lobby {
        host: ExactAccountNumber,
        enemy_count: u8,
        slots: Vec<String>,
        players: Vec<LobbyPlayer>,
    },
    #[serde(rename = "matchStarted")]
    MatchStarted {
        host: ExactAccountNumber,
        enemy_count: u8,
        roster: Vec<RosterSlot>,
        #[serde(default, skip_serializing_if = "Vec::is_empty")]
        banx_locks: Vec<BanxLockWire>,
    },
    #[serde(rename = "roster")]
    Roster { roster: Vec<RosterSlot> },
    #[serde(rename = "input")]
    Input {
        from: ExactAccountNumber,
        tank_id: String,
        turn: f64,
        throttle: f64,
        fire: bool,
    },
    #[serde(rename = "stateSnapshot")]
    StateSnapshot { state: Value },
    #[serde(rename = "matchEnded")]
    MatchEnded,
    #[serde(rename = "error")]
    Error { code: String, reason: String },
    #[serde(rename = "banxStatus")]
    BanxStatus {
        from: ExactAccountNumber,
        on: bool,
        asset_id: u16,
        units: String,
        symbol: String,
    },
    #[serde(rename = "banxOffer")]
    BanxOffer {
        from: ExactAccountNumber,
        to: ExactAccountNumber,
        required_units: String,
        required_asset: u16,
        required_symbol: String,
        match_peer_units: String,
        match_peer_asset: u16,
        match_peer_symbol: String,
        lock: BanxLockWire,
    },
    #[serde(rename = "banxOfferReply")]
    BanxOfferReply {
        from: ExactAccountNumber,
        to: ExactAccountNumber,
        accept: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        lock: Option<BanxLockWire>,
    },
    #[serde(rename = "banxLock")]
    BanxLock { lock: BanxLockWire },
    #[serde(rename = "banxHit")]
    BanxHit {
        hit_id: u64,
        victim: ExactAccountNumber,
        shooter: ExactAccountNumber,
    },
}

pub fn encode_server_frame(frame: &ServerFrame) -> Result<String, String> {
    serde_json::to_string(frame).map_err(|e| e.to_string())
}

pub fn parse_client_frame(data: &[u8]) -> Result<ClientFrame, ProtocolError> {
    let text = std::str::from_utf8(data)
        .map_err(|_| ProtocolError::MalformedJson("frame is not utf-8".into()))?;
    serde_json::from_str(text)
        .map_err(|e| ProtocolError::MalformedJson(format!("invalid client frame: {e}")))
}
