use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;
use serde::Deserialize;

pub const OAUTH_REQUEST_KEY: &str = "active_oauth_request";

pub struct AccessGrants;

impl AccessGrants {
    pub fn set(user: &str, caller: &str, callee: &str) {
        let any_value = "1".as_bytes();
        Keyvalue::set(&format!("{user}:{callee}<-{caller}"), &any_value)
            .expect("Failed to set access grant")
    }
    pub fn get(user: &str, caller: &str, callee: &str) -> Option<Vec<u8>> {
        Keyvalue::get(&format!("{user}:{callee}<-{caller}"))
    }
    pub fn delete(user: &str, caller: &str, callee: &str) {
        Keyvalue::delete(&format!("{user}:{callee}<-{caller}"));
    }
}

pub struct ActiveOauthRequest;

#[derive(Deserialize)]
pub struct ActiveOauthRequestPayload {
    #[allow(dead_code)]
    pub id: String,
    pub user: String,
    #[allow(dead_code)]
    pub caller: String,
    #[allow(dead_code)]
    pub callee: String,
}

impl ActiveOauthRequest {
    pub fn get(&self) -> Option<ActiveOauthRequestPayload> {
        match Keyvalue::get(OAUTH_REQUEST_KEY) {
            Some(oauth_request_bytes) => {
                let decoded_text =
                    String::from_utf8(oauth_request_bytes).expect("Failed to decode UTF-8 bytes");
                Some(
                    serde_json::from_str::<ActiveOauthRequestPayload>(&decoded_text)
                        .expect("Failed to parse active oauth request"),
                )
            }
            None => None,
        }
    }
}
