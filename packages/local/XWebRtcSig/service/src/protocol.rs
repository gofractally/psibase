//! Websocket frames and ICE structs for `psibase.realtime.v1` (architecture §5.1).

use psibase::ExactAccountNumber;
use serde::{Deserialize, Serialize};
use serde_json::Value;

pub const REALTIME_SUBPROTOCOL_V1: &str = "psibase.realtime.v1";

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
    },
    #[serde(rename = "error")]
    Error {
        code: String,
        reason: String,
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

fn url_schemes_lower(urls: &[String]) -> Vec<String> {
    urls
        .iter()
        .map(|u| {
            u.trim()
                .split_once(':')
                .map(|(scheme, _)| scheme.to_ascii_lowercase())
                .unwrap_or_default()
        })
        .collect()
}

pub fn ice_server_config_is_valid_for_clients(entry: &IceServerConfig) -> bool {
    let urls: Vec<String> = match &entry.urls {
        IceServerUrls::One(u) => vec![u.clone()],
        IceServerUrls::Many(v) => v.clone(),
    };
    if urls.is_empty() || urls.iter().any(|u| u.trim().is_empty()) {
        return false;
    }
    let schemes = url_schemes_lower(&urls);
    let has_turn = schemes.iter().any(|s| s == "turn" || s == "turns");
    let has_stun = schemes.iter().any(|s| s == "stun" || s == "stuns");
    if has_turn {
        let user_ok = entry
            .username
            .as_ref()
            .map(|s| !s.is_empty())
            .unwrap_or(false);
        let cred_ok = entry
            .credential
            .as_ref()
            .map(|s| !s.is_empty())
            .unwrap_or(false);
        user_ok && cred_ok
    } else {
        has_stun && entry.username.is_none() && entry.credential.is_none()
    }
}

pub fn default_stun_ice_server_configs() -> Vec<IceServerConfig> {
    vec![
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
    ]
}

/// Merges default STUN servers with TURN entries from node admin JSON (`[]` if unset).
pub fn merged_ice_servers(turn_json: &str) -> Vec<IceServerConfig> {
    let mut servers = default_stun_ice_server_configs();
    let Ok(extra) = serde_json::from_str::<Vec<IceServerConfig>>(turn_json) else {
        return servers;
    };
    for entry in extra {
        if ice_server_config_is_valid_for_clients(&entry) {
            servers.push(entry);
        }
    }
    servers
}

pub fn parse_client_frame(input: &[u8]) -> Result<ClientFrame, ProtocolError> {
    let value: Value = serde_json::from_slice(input)
        .map_err(|err| ProtocolError::MalformedJson(err.to_string()))?;
    let frame_type = value
        .get("t")
        .and_then(Value::as_str)
        .ok_or_else(|| ProtocolError::InvalidFrame("frame discriminator `t` is required".into()))?;

    const KNOWN: &[&str] = &["clientReady", "ping"];
    if !KNOWN.iter().any(|k| *k == frame_type) {
        return Err(ProtocolError::UnknownFrameType(frame_type.into()));
    }

    serde_json::from_value(value).map_err(|err| ProtocolError::InvalidFrame(err.to_string()))
}

pub fn encode_server_frame(frame: &ServerFrame) -> Result<String, ProtocolError> {
    serde_json::to_string(frame).map_err(|err| ProtocolError::InvalidFrame(err.to_string()))
}

pub fn validate_client_frame(frame: &ClientFrame) -> Result<(), ProtocolError> {
    match frame {
        ClientFrame::ClientReady {
            client_instance_id, ..
        } => validate_required_id("clientInstanceId", client_instance_id),
        ClientFrame::Ping => Ok(()),
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
        let frame = ServerFrame::Welcome {
            user: "alice".parse().unwrap(),
            server_time: 42,
            ice_servers: default_stun_ice_server_configs(),
        };
        let json = encode_server_frame(&frame).unwrap();
        assert!(json.contains(r#""t":"welcome""#));
        assert!(json.contains(r#""iceServers""#));
        assert!(json.contains(r#""serverTime":42"#));
    }

    #[test]
    fn merge_keeps_stun_when_turn_json_invalid() {
        let servers = merged_ice_servers("not json");
        assert_eq!(servers.len(), 2);
        assert!(servers.iter().all(ice_server_config_is_valid_for_clients));
    }

    #[test]
    fn merge_appends_valid_turn() {
        let json = r#"[{"urls":["turn:relay.example:3478"],"username":"u","credential":"c"}]"#;
        let servers = merged_ice_servers(json);
        assert_eq!(servers.len(), 3);
    }

    #[test]
    fn rejects_turn_without_credential() {
        let json = r#"[{"urls":["turn:relay.example:3478"],"username":"u"}]"#;
        let servers = merged_ice_servers(json);
        assert_eq!(servers.len(), 2);
    }

    #[test]
    fn rejects_stun_with_credentials() {
        let entry = IceServerConfig {
            urls: IceServerUrls::One("stun:stun.example:3478".into()),
            username: Some("u".into()),
            credential: Some("c".into()),
        };
        assert!(!ice_server_config_is_valid_for_clients(&entry));
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
}
