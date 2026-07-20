//! ICE server merge and client validation.
//!
//! Default STUN entries and TURN entries from node admin JSON are merged for the
//! `welcome` frame. TURN secrets remain in `x-admin`; only `x-webrtc-sig` reads them.

use crate::protocol::{IceServerConfig, IceServerUrls};

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

#[cfg(test)]
mod tests {
    use super::*;
    use crate::protocol::IceServerUrls;

    #[test]
    fn merge_keeps_stun_when_turn_json_invalid() {
        let servers = merged_ice_servers("not json");
        assert_eq!(servers.len(), 2);
        assert!(servers.iter().all(ice_server_config_is_valid_for_clients));
    }

    #[test]
    fn merge_empty_turn_array_uses_default_stun_only() {
        // XAdmin returns "[]" when unset or unauthorized; welcome must still work.
        let servers = merged_ice_servers("[]");
        assert_eq!(servers, default_stun_ice_server_configs());
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
}
