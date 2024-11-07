use crate::bindings::accounts::plugin::types::OriginationData;
use base64::{engine::general_purpose::URL_SAFE, Engine};
use psibase::fracpack::{Pack, Unpack};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Pack, Unpack, Clone)]
pub struct ConnectionToken {
    pub app_origin: String,
    pub app: Option<String>,
    pub creation_time: u64,
}

impl ConnectionToken {
    pub fn new(sender: &OriginationData) -> Self {
        Self {
            app_origin: sender.origin.to_string(),
            app: sender.app.clone(),
            creation_time: SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        }
    }

    pub fn from_str(token: &str) -> Option<Self> {
        if let Ok(token) = URL_SAFE.decode(token) {
            if let Ok(token) = <ConnectionToken>::unpacked(&token) {
                return Some(token);
            }
        }

        None
    }
}
