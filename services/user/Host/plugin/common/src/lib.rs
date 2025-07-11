#[allow(warnings)]
mod bindings;
use bindings::*;

mod helpers;
use helpers::*;
mod plugin_ref;

mod types;
use exports::host::common::{
    admin::Guest as Admin,
    client::Guest as Client,
    server::Guest as Server,
    types::Guest as Types,
    types::{BodyTypes, Error, OriginationData, PostRequest},
};
use supervisor::bridge::{
    intf as Supervisor,
    types::{self as BridgeTypes, HttpRequest, HttpResponse},
};
use url::Url;

struct HostCommon;

fn do_post(app: String, endpoint: String, content: BodyTypes) -> Result<HttpResponse, Error> {
    let (ty, content) = content.get_content();
    Ok(HttpRequest {
        uri: format!("{}/{}", HostCommon::get_app_url(app), endpoint),
        method: "POST".to_string(),
        headers: make_headers(&[("Content-Type", &ty)]),
        body: Some(content),
    }
    .send()?)
}

fn do_get(app: String, endpoint: String) -> Result<HttpResponse, Error> {
    Ok(HttpRequest {
        uri: format!("{}/{}", HostCommon::get_app_url(app), endpoint),
        method: "GET".to_string(),
        headers: make_headers(&[("Accept", "application/json")]),
        body: None,
    }
    .send()?)
}

impl Admin for HostCommon {
    fn get_active_app() -> OriginationData {
        let app = caller();

        if app != "accounts" && app != "staged-tx" {
            panic!(
                "Only accounts and staged-tx can call this function, current app: {}",
                app
            );
        }

        let active_app = Supervisor::get_active_app();
        OriginationData {
            app: active_app.app,
            origin: active_app.origin,
        }
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
                return Err(make_error(&json["errors"].to_string()));
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
    fn get_sender_app() -> OriginationData {
        // This is exported for use by other plugins who want to know which app called *them*
        // So need to look back 2 frames in the callstack
        let frame = 2;
        let stack = get_callstack();
        assert!(stack.len() >= frame);
        let service = stack[stack.len() - frame].clone();
        OriginationData {
            app: Some(service.clone()),
            origin: Self::get_app_url(service),
        }
    }

    fn my_service_account() -> String {
        caller()
    }

    fn my_service_origin() -> String {
        Self::get_app_url(caller())
    }

    fn prompt_user(
        _subpath: Option<String>,
        _payload_json_str: Option<String>,
    ) -> Result<(), Error> {
        unimplemented!()
    }

    fn get_app_url(app: String) -> String {
        let root = Supervisor::get_root_domain();
        if app == "homepage" {
            return root;
        }

        let mut url = Url::parse(&root).unwrap();
        url.set_host(Some(&format!("{}.{}", app, url.host_str().unwrap())))
            .unwrap();
        url.to_string().trim_end_matches('/').to_string()
    }
}

impl Types for HostCommon {
    type PluginRef = plugin_ref::PluginRef;
}

bindings::export!(HostCommon with_types_in bindings);
