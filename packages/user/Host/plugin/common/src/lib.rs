#[allow(warnings)]
mod bindings;
use bindings::*;

mod helpers;
use helpers::*;
mod bucket;

mod types;

use bindings::host::auth::api as HostAuth;
use exports::host::common::{
    admin::Guest as Admin,
    client::Guest as Client,
    server::Guest as Server,
    store::{DbMode, Guest as Store},
};
use helpers::make_error;
use host::types::types::{BodyTypes, Error, PostRequest};
use platform::bridge::{
    intf as Platform,
    types::{self as BridgeTypes, HttpRequest, HttpResponse},
};
use url::Url;

use crate::bindings::platform::bridge::intf::get_active_app;

struct HostCommon;

fn do_post(app: String, endpoint: String, content: BodyTypes) -> Result<HttpResponse, Error> {
    let (ty, content) = content.get_content();
    let query_auth_token = HostAuth::get_active_query_token(&get_active_app());
    let headers = if query_auth_token.is_none() {
        make_headers(&[("Content-Type", &ty)])
    } else {
        make_headers(&[
            ("Content-Type", &ty),
            ("Authorization", &query_auth_token.unwrap()),
        ])
    };
    Ok(HttpRequest {
        uri: format!("{}/{}", HostCommon::get_app_url(app), endpoint),
        method: "POST".to_string(),
        headers,
        body: Some(content),
    }
    .send()?)
}

fn do_get(app: String, endpoint: String) -> Result<HttpResponse, Error> {
    let query_auth_token = HostAuth::get_active_query_token(&get_active_app());
    let headers = if query_auth_token.is_none() {
        make_headers(&[("Accept", "application/json")])
    } else {
        make_headers(&[
            ("Accept", "application/json"),
            ("Authorization", &query_auth_token.unwrap()),
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

impl Admin for HostCommon {
    fn get_active_app() -> String {
        check_caller(
            &["accounts", "staged-tx"],
            "get-active-app@host:common/admin",
        );

        Platform::get_active_app()
    }

    fn post(app: String, request: PostRequest) -> Result<Option<BodyTypes>, Error> {
        check_caller(&["host"], "post@host:common/admin");

        let endpoint = normalize_endpoint(request.endpoint);
        let res = do_post(app, endpoint, request.body)?;
        Ok(res.body.map(Into::into))
    }
}

impl Server for HostCommon {
    fn post_graphql_get_json(graphql: String) -> Result<String, Error> {
        let res = HttpRequest {
            uri: format!("{}/{}", HostCommon::get_app_url(caller()), "graphql"),
            method: "POST".to_string(),
            headers: make_headers(&[("Content-Type", "application/graphql")]),
            body: Some(BridgeTypes::BodyTypes::Text(graphql)),
        }
        .send()?;

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
        let root = Platform::get_root_domain();
        if app == "homepage" {
            return root;
        }

        let mut url = Url::parse(&root).unwrap();
        url.set_host(Some(&format!("{}.{}", app, url.host_str().unwrap())))
            .unwrap();
        url.to_string().trim_end_matches('/').to_string()
    }

    fn is_sender_host() -> bool {
        let sender = Self::get_sender();
        sender == "host" || sender == Platform::get_platform_account()
    }
}

impl Store for HostCommon {
    type Bucket = bucket::Bucket;

    fn clear_buffers() {
        use crate::bucket::host_buffer;

        check_caller(&["transact"], "clear-buffers@host:common/store");
        host_buffer::clear_all();
    }

    fn flush_transactional_data() {
        use crate::bucket::host_buffer;
        use crate::platform::bridge::database as HostDb;

        check_caller(&["transact"], "flush@host:common/store");

        let buffer_data = host_buffer::drain_all(DbMode::Transactional);

        for (db, entries) in buffer_data {
            for (key, op) in entries {
                if let Some(value) = op.0 {
                    HostDb::set(db.duration as u8, &key, &value);
                } else {
                    HostDb::remove(db.duration as u8, &key);
                }
            }
        }
    }
}

bindings::export!(HostCommon with_types_in bindings);
