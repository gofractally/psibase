use crate::bindings::host::client::api::get_sender;
use crate::bindings::host::types::types::{Error, PluginId};
use crate::bindings::supervisor::bridge::{
    intf as Supervisor,
    types::{BodyTypes, Header, HttpRequest},
};
use crate::bindings::transact::login::api as Login;
use serde::Deserialize;
use url::Url;

pub fn check_caller(allowed: &[&str], context: &str) {
    let app = get_sender();
    if !allowed.contains(&app.as_str()) {
        panic!("[{}] Unauthorized caller: {}", context, app);
    }
}

fn make_error(message: &str) -> Error {
    Error {
        code: 0,
        producer: PluginId {
            service: "host".to_string(),
            plugin: "auth".to_string(),
        },
        message: message.to_string(),
    }
}

fn root_host() -> String {
    Url::parse(&Supervisor::get_root_domain())
        .expect("Failed to parse root domain")
        .host_str()
        .expect("Root domain has no host")
        .to_string()
}

#[derive(Deserialize)]
struct LoginReply {
    access_token: String,
    #[allow(dead_code)]
    token_type: String,
}

pub fn mint_query_token(app: &str, user: &str, auth_service: &str) -> Result<String, Error> {
    let packed = Login::build(
        &app.to_string(),
        &user.to_string(),
        &root_host(),
        &auth_service.to_string(),
    )?;

    let req = HttpRequest {
        uri: format!(
            "{}/login",
            crate::bindings::host::client::api::get_app_url("transact")
        ),
        method: "POST".to_string(),
        headers: vec![Header {
            key: "Content-Type".to_string(),
            value: "application/octet-stream".to_string(),
        }],
        body: Some(BodyTypes::Bytes(packed)),
    };

    let response = Supervisor::send_request(&req, false)?;
    match response.body {
        Some(BodyTypes::Json(t)) => {
            let reply = serde_json::from_str::<LoginReply>(&t)
                .map_err(|e| make_error(&format!("Failed to deserialize login reply: {e}")))?;
            Ok(reply.access_token)
        }
        _ => Err(make_error("Invalid login response body")),
    }
}
