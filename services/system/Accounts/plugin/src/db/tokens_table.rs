use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;
use crate::db::DbKeys;
use base64::{engine::general_purpose::URL_SAFE, Engine};
use psibase::fracpack::{Pack, Unpack};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

#[derive(Pack, Unpack, Clone)]
pub struct ConnectionToken {
    pub app_origin: String,
    pub app: Option<String>,
    pub expiration_time: u64,
}

impl ConnectionToken {
    pub fn new(app_origin: &str, app: Option<String>) -> Self {
        let expiration_time = SystemTime::now() + Duration::from_secs(10 * 60); // 10 minutes
        Self {
            app_origin: app_origin.to_string(),
            app,
            expiration_time: expiration_time
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_secs(),
        }
    }
}

#[derive(Pack, Unpack)]
struct ConnectionTokens {
    tokens: Vec<ConnectionToken>,
}

impl Default for ConnectionTokens {
    fn default() -> Self {
        Self { tokens: vec![] }
    }
}

impl ConnectionTokens {
    pub fn add(&mut self, token: ConnectionToken) {
        self.tokens.retain(|t| t.app_origin != token.app_origin);
        self.tokens.push(token);
    }

    pub fn remove_expired(&mut self) {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs();
        self.tokens.retain(|t| t.expiration_time > now);
    }

    pub fn decode(&self, token: &str) -> Option<ConnectionToken> {
        let packed_token = URL_SAFE.decode(token).expect("Invalid connection token");
        self.tokens
            .iter()
            .find(|&t| t.packed() == packed_token)
            .map(|t| t.clone())
    }
}

// A database using the global `accounts` namespace
pub struct TokensTable {}
impl TokensTable {
    pub fn new() -> Self {
        Self {}
    }

    pub fn add_connection_token(&self, app_origin: &str, app: Option<String>) -> String {
        let mut tokens = Keyvalue::get(&DbKeys::CONNECT_TOKENS)
            .map(|t| <ConnectionTokens>::unpacked(&t).expect("Failed to unpack connection tokens"))
            .unwrap_or_default();

        tokens.remove_expired();

        let token = ConnectionToken::new(app_origin, app);
        let packed_token = &token.packed();

        tokens.add(token);
        Keyvalue::set(&DbKeys::CONNECT_TOKENS, &tokens.packed())
            .expect("Failed to set connect token");

        URL_SAFE.encode(packed_token)
    }

    pub fn decode(&self, token: &str) -> Option<ConnectionToken> {
        let tokens = Keyvalue::get(&DbKeys::CONNECT_TOKENS)
            .map(|t| <ConnectionTokens>::unpacked(&t).expect("Failed to unpack connection tokens"))
            .unwrap_or_default();

        tokens.decode(token)
    }
}
