#[allow(warnings)]
mod bindings;
use bindings::*;

mod helpers;
use helpers::*;

mod types;

use bindings::host::auth::api as HostAuth;
use exports::host::http::api::Guest as Api;
use helpers::make_error;
use host::client::api as CallContext;
use host::types::types::{BodyTypes, Error, PostRequest};
use psibase::AccountNumber;
use supervisor::bridge::types::{self as BridgeTypes, HttpRequest};

struct HostHttp;

fn get_auth_token() -> Option<String> {
    let current_user = host::accounts::api::get_current_user();
    if current_user.is_some() {
        HostAuth::get_active_query_token(&CallContext::get_active_app(), &current_user.unwrap())
    } else {
        None
    }
}

fn do_post(
    app: String,
    endpoint: String,
    content: BodyTypes,
) -> Result<BridgeTypes::HttpResponse, Error> {
    let (ty, content) = content.get_content();

    let auth_token = get_auth_token();
    let headers = if auth_token.is_none() {
        make_headers(&[("Content-Type", &ty)])
    } else {
        make_headers(&[
            ("Content-Type", &ty),
            ("Authorization", &format!("Bearer {}", auth_token.unwrap())),
        ])
    };
    Ok(HttpRequest {
        uri: format!("{}/{}", CallContext::get_app_url(&app), endpoint),
        method: "POST".to_string(),
        headers,
        body: Some(content),
    }
    .send()?)
}

fn do_get(app: String, endpoint: String) -> Result<BridgeTypes::HttpResponse, Error> {
    let auth_token = get_auth_token();
    let headers = if auth_token.is_none() {
        make_headers(&[("Accept", "application/json")])
    } else {
        make_headers(&[
            ("Accept", "application/json"),
            ("Authorization", &format!("Bearer {}", auth_token.unwrap())),
        ])
    };
    Ok(HttpRequest {
        uri: format!("{}/{}", CallContext::get_app_url(&app), endpoint),
        method: "GET".to_string(),
        headers,
        body: None,
    }
    .send()?)
}

fn assert_active_app_caller(context: &str) -> String {
    let sender = CallContext::get_sender();
    let active_app = CallContext::get_active_app();
    assert!(
        sender == active_app,
        "[{}] Unauthorized caller: {}",
        context,
        sender
    );
    active_app
}

impl Api for HostHttp {
    fn post_graphql_get_json(graphql: String) -> Result<String, Error> {
        let res = do_post(
            CallContext::get_sender(),
            "graphql".to_string(),
            BodyTypes::Graphql(graphql),
        )?;

        if let Some(BridgeTypes::BodyTypes::Json(body)) = res.body {
            let json: serde_json::Value =
                serde_json::from_str(&body).map_err(|e| make_error(&e.to_string()))?;

            if json["errors"].is_null() {
                return Ok(body);
            } else {
                return Err(make_error(&format!(
                    "Graphql query error: {}",
                    &json["errors"].to_string()
                )));
            }
        }

        Err(make_error("Invalid graphql response: 'body' must be JSON"))
    }

    fn post(request: PostRequest) -> Result<BodyTypes, Error> {
        let endpoint = normalize_endpoint(request.endpoint);
        let res = do_post(CallContext::get_sender(), endpoint, request.body)?;

        // TODO: post should return Option<BodyTypes> because not all posts return a body
        match res.body {
            Some(body) => Ok(body.into()),
            None => Err(make_error("Http response body absent")),
        }
    }

    fn get_json(endpoint: String) -> Result<String, Error> {
        let endpoint = normalize_endpoint(endpoint);
        let res = do_get(CallContext::get_sender(), endpoint)?;

        match res.body {
            Some(BridgeTypes::BodyTypes::Json(body)) => Ok(body),
            _ => Err(make_error("Http response body absent or wrong type")),
        }
    }

    fn get_ws_ticket(service: String, path: String) -> Result<String, Error> {
        let app = assert_active_app_caller("get-ws-ticket@host:http/api");

        AccountNumber::from_exact(&service)
            .map_err(|_| make_error(&format!("Invalid service: {}", service)))?;
        if path.is_empty() || !path.starts_with('/') {
            return Err(make_error("path must be a non-empty absolute path"));
        }

        let Some(token) = get_auth_token() else {
            return Err(make_error("No authenticated user"));
        };

        let body = serde_json::json!({ "app": app, "service": service, "path": path }).to_string();
        let res = do_post(
            "wsauth".to_string(),
            "ws-ticket".to_string(),
            BodyTypes::Json(body),
        )?;

        let Some(BridgeTypes::BodyTypes::Json(body)) = res.body else {
            return Err(make_error(
                "Invalid ws-ticket response: 'body' must be JSON",
            ));
        };
        let json: serde_json::Value =
            serde_json::from_str(&body).map_err(|e| make_error(&e.to_string()))?;
        let ticket = json["ticket"]
            .as_str()
            .ok_or_else(|| make_error("Invalid ws-ticket response: missing 'ticket'"))?;
        if ticket.contains(&token) {
            return Err(make_error(
                "Invalid ws-ticket response: ticket contains session token",
            ));
        }
        Ok(ticket.to_string())
    }
}

bindings::export!(HostHttp with_types_in bindings);
