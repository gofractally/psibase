#[allow(warnings)]
mod bindings;
use bindings::*;

mod helpers;
use helpers::*;

mod types;

use bindings::host::auth::api as HostAuth;
use exports::host::common::{
    admin::Guest as Admin, client::Guest as Client, server::Guest as Server,
};
use helpers::make_error;
use host::types::types::{BodyTypes, Error, PostRequest};
use supervisor::bridge::{
    intf as Supervisor,
    types::{self as BridgeTypes, HttpRequest, HttpResponse},
};
use url::Url;

struct HostCommon;

fn get_auth_token() -> Option<String> {
    let current_user = accounts::plugin::api::get_current_user();
    if current_user.is_some() {
        HostAuth::get_active_query_token(&HostCommon::get_active_app(), &current_user.unwrap())
    } else {
        None
    }
}

fn do_post_internal(
    app: String,
    endpoint: String,
    content: BodyTypes,
    with_credentials: bool,
) -> Result<HttpResponse, Error> {
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
    let request = HttpRequest {
        uri: format!("{}/{}", HostCommon::get_app_url(app), endpoint),
        method: "POST".to_string(),
        headers,
        body: Some(content),
    };
    if with_credentials {
        Ok(request.send_with_credentials()?)
    } else {
        Ok(request.send()?)
    }
}

fn do_post(app: String, endpoint: String, content: BodyTypes) -> Result<HttpResponse, Error> {
    do_post_internal(app, endpoint, content, false)
}

fn do_post_with_credentials(
    app: String,
    endpoint: String,
    content: BodyTypes,
) -> Result<HttpResponse, Error> {
    do_post_internal(app, endpoint, content, true)
}

fn do_get(app: String, endpoint: String) -> Result<HttpResponse, Error> {
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
        uri: format!("{}/{}", HostCommon::get_app_url(app), endpoint),
        method: "GET".to_string(),
        headers,
        body: None,
    }
    .send()?)
}

fn do_get_bytes(app: String, endpoint: String) -> Result<HttpResponse, Error> {
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
        uri: format!("{}/{}", HostCommon::get_app_url(app), endpoint),
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

    if parsed.scheme() != root.scheme() || parsed.port_or_known_default() != root.port_or_known_default()
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

fn fetch_sibling(url: &str, bytes: bool) -> Result<HttpResponse, Error> {
    let (app, endpoint) = parse_sibling_url(url)?;
    if bytes {
        do_get_bytes(app, endpoint)
    } else {
        do_get(app, endpoint)
    }
}

impl Admin for HostCommon {
    fn post(app: String, request: PostRequest) -> Result<Option<BodyTypes>, Error> {
        check_caller(&["host"], "post@host:common/admin");

        let endpoint = normalize_endpoint(request.endpoint);
        let res = do_post(app, endpoint, request.body)?;
        Ok(res.body.map(Into::into))
    }

    fn post_with_credentials(
        app: String,
        request: PostRequest,
    ) -> Result<Option<BodyTypes>, Error> {
        check_caller(&["host"], "post-with-credentials@host:common/admin");

        let endpoint = normalize_endpoint(request.endpoint);
        let res = do_post_with_credentials(app, endpoint, request.body)?;
        Ok(res.body.map(Into::into))
    }
}

impl Server for HostCommon {
    fn post_graphql_get_json(graphql: String) -> Result<String, Error> {
        let res = do_post(caller(), "graphql".to_string(), BodyTypes::Graphql(graphql))?;

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
        let res = do_post(caller(), endpoint, request.body)?;

        // TODO: post should return Option<BodyTypes> because not all posts return a body
        match res.body {
            Some(body) => Ok(body.into()),
            None => Err(make_error("Http response body absent")),
        }
    }

    fn get_json(endpoint: String) -> Result<String, Error> {
        let endpoint = normalize_endpoint(endpoint);
        let res = do_get(caller(), endpoint)?;

        match res.body {
            Some(BridgeTypes::BodyTypes::Json(body)) => Ok(body),
            _ => Err(make_error("Http response body absent or wrong type")),
        }
    }

    fn fetch_sibling_json(url: String) -> Result<String, Error> {
        let res = fetch_sibling(&url, false)?;

        match res.body {
            Some(BridgeTypes::BodyTypes::Json(body)) => Ok(body),
            Some(BridgeTypes::BodyTypes::Text(body)) => Ok(body),
            _ => Err(make_error("Http response body absent or wrong type")),
        }
    }

    fn fetch_sibling_bytes(url: String) -> Result<Vec<u8>, Error> {
        let res = fetch_sibling(&url, true)?;

        match res.body {
            Some(BridgeTypes::BodyTypes::Bytes(body)) => Ok(body),
            _ => Err(make_error("Http response body absent or wrong type")),
        }
    }
}

impl Client for HostCommon {
    fn get_sender() -> String {
        // This is exported for use by other plugins who want to know which app called *them*
        // So need to look back 2 frames in the callstack
        let frame = 2;
        let stack = get_callstack();
        assert!(stack.len() >= frame);
        stack[stack.len() - frame].clone()
    }

    fn get_receiver() -> String {
        caller()
    }

    fn get_app_url(app: String) -> String {
        let root = Supervisor::get_root_domain();
        let mut url = Url::parse(&root).unwrap();
        url.set_host(Some(&format!("{}.{}", app, url.host_str().unwrap())))
            .unwrap();
        url.to_string().trim_end_matches('/').to_string()
    }

    fn get_active_app() -> String {
        let stack = get_callstack();
        assert!(stack.len() > 0);
        stack.into_iter().next().unwrap()
    }
}

bindings::export!(HostCommon with_types_in bindings);
