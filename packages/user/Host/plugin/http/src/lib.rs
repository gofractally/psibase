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
use supervisor::bridge::{
    intf as Supervisor,
    types::{self as BridgeTypes, HttpRequest},
};
use url::Url;

struct HostHttp;

fn get_auth_token() -> Option<String> {
    let current_user = accounts::query::api::get_current_user();
    if current_user.is_some() {
        HostAuth::get_active_query_token(&CallContext::get_active_app(), &current_user.unwrap())
    } else {
        None
    }
}

fn do_post(app: String, endpoint: String, content: BodyTypes) -> Result<BridgeTypes::HttpResponse, Error> {
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

fn do_get_bytes(app: String, endpoint: String) -> Result<BridgeTypes::HttpResponse, Error> {
    let auth_token = get_auth_token();
    let headers = if auth_token.is_none() {
        make_headers(&[("Accept", "*/*")])
    } else {
        make_headers(&[
            ("Accept", "*/*"),
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

fn parse_sibling_url(url: &str) -> Result<(String, String), Error> {
    let parsed = Url::parse(url).map_err(|e| make_error(&e.to_string()))?;
    let root = Url::parse(&Supervisor::get_root_domain()).map_err(|e| make_error(&e.to_string()))?;
    let root_host = root
        .host_str()
        .ok_or_else(|| make_error("Invalid root domain"))?;

    if parsed.scheme() != root.scheme()
        || parsed.port_or_known_default() != root.port_or_known_default()
    {
        return Err(make_error("URL is not on the current chain"));
    }

    let fetch_host = parsed
        .host_str()
        .ok_or_else(|| make_error("URL is missing a host"))?;
    let app = if fetch_host == root_host {
        return Err(make_error("URL must target a sibling service"));
    } else if let Some(prefix) = fetch_host.strip_suffix(&format!(".{}", root_host)) {
        prefix.to_string()
    } else {
        return Err(make_error("URL is not on the current chain"));
    };

    let mut endpoint = parsed.path().trim_start_matches('/').to_string();
    if let Some(query) = parsed.query() {
        endpoint.push('?');
        endpoint.push_str(query);
    }
    Ok((app, endpoint))
}

fn fetch_sibling(url: &str, bytes: bool) -> Result<BridgeTypes::HttpResponse, Error> {
    let (app, endpoint) = parse_sibling_url(url)?;
    if bytes {
        do_get_bytes(app, endpoint)
    } else {
        do_get(app, endpoint)
    }
}

fn assert_packages_caller(context: &str) {
    let sender = CallContext::get_sender();
    assert!(
        sender == "packages",
        "[{}] Unauthorized caller: {}",
        context,
        sender
    );
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

    fn fetch_sibling_json(url: String) -> Result<String, Error> {
        assert_packages_caller("fetch-sibling-json@host:http/api");

        let res = fetch_sibling(&url, false)?;

        match res.body {
            Some(BridgeTypes::BodyTypes::Json(body)) => Ok(body),
            Some(BridgeTypes::BodyTypes::Text(body)) => Ok(body),
            _ => Err(make_error("Http response body absent or wrong type")),
        }
    }

    fn fetch_sibling_bytes(url: String) -> Result<Vec<u8>, Error> {
        assert_packages_caller("fetch-sibling-bytes@host:http/api");

        let res = fetch_sibling(&url, true)?;

        match res.body {
            Some(BridgeTypes::BodyTypes::Bytes(body)) => Ok(body),
            _ => Err(make_error("Http response body absent or wrong type")),
        }
    }
}

bindings::export!(HostHttp with_types_in bindings);
