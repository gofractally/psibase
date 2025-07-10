#[allow(warnings)]
mod bindings;

use bindings::*;
use exports::host::common::types::{
    BodyTypes, Error, GuestPluginRef, OriginationData, PluginId, PostRequest,
};
use exports::host::common::{
    client::Guest as Client, server::Guest as Server, types::Guest as Types,
};
use supervisor::bridge::intf as Supervisor;
use url::Url;

use crate::bindings::supervisor::bridge::types::{
    self as BridgeTypes, Header, HttpRequest, HttpResponse,
};

struct HostCommon;

impl From<BridgeTypes::PluginId> for PluginId {
    fn from(e: BridgeTypes::PluginId) -> Self {
        PluginId {
            service: e.service,
            plugin: e.plugin,
        }
    }
}

impl From<BridgeTypes::Error> for Error {
    fn from(e: BridgeTypes::Error) -> Self {
        Error {
            code: e.code,
            producer: e.producer.into(),
            message: e.message,
        }
    }
}

fn get_self() -> PluginId {
    PluginId {
        service: "host".to_string(),
        plugin: "common".to_string(),
    }
}

fn make_error(message: &str) -> Error {
    Error {
        code: 0,
        producer: get_self(),
        message: message.to_string(),
    }
}

fn post_graphql(origin: String, graphql: String) -> Result<HttpResponse, BridgeTypes::Error> {
    let req = HttpRequest {
        uri: format!("{}/graphql", origin),
        method: "POST".to_string(),
        headers: vec![Header {
            key: "Content-Type".to_string(),
            value: "application/graphql".to_string(),
        }],
        body: Some(BridgeTypes::BodyTypes::Text(graphql)),
    };
    Supervisor::sync_send(&req)
}

fn get_json_request(url: String) -> Result<HttpResponse, BridgeTypes::Error> {
    let req = HttpRequest {
        uri: url,
        method: "GET".to_string(),
        headers: vec![Header {
            key: "Accept".to_string(),
            value: "application/json".to_string(),
        }],
        body: None,
    };
    Supervisor::sync_send(&req)
}

fn post_graphql_from_app_get_json(app: String, graphql: String) -> Result<String, Error> {
    let origin = HostCommon::get_app_url(app.clone());
    let res = post_graphql(origin, graphql).map_err(|e| Error::from(e))?;

    if let Some(BridgeTypes::BodyTypes::Json(body)) = res.body {
        let json: serde_json::Value =
            serde_json::from_str(&body).map_err(|e| make_error(&e.to_string()))?;

        if json["errors"].is_null() {
            return Ok(body);
        } else {
            return Err(make_error(&json["errors"].to_string()));
        }
    }

    Err(make_error("Http response body absent or wrong type"))
}

fn caller() -> String {
    let stack = get_callstack();
    assert!(stack.len() > 0);
    stack.last().unwrap().clone()
}

fn get_callstack() -> Vec<String> {
    let mut stack = Supervisor::service_stack();
    // the last element is always this plugin, so we can pop it
    // We are interested in the callstack before this call
    stack.pop();
    stack
}

impl From<BridgeTypes::BodyTypes> for BodyTypes {
    fn from(e: BridgeTypes::BodyTypes) -> Self {
        match e {
            BridgeTypes::BodyTypes::Text(t) => BodyTypes::Text(t),
            BridgeTypes::BodyTypes::Bytes(b) => BodyTypes::Bytes(b),
            BridgeTypes::BodyTypes::Json(j) => BodyTypes::Json(j),
        }
    }
}

impl Server for HostCommon {
    fn post_graphql_get_json(graphql: String) -> Result<String, Error> {
        post_graphql_from_app_get_json(caller(), graphql)
    }

    fn post(request: PostRequest) -> Result<BodyTypes, Error> {
        let endpoint = request
            .endpoint
            .strip_prefix('/')
            .unwrap_or(&request.endpoint)
            .to_string();

        let url = format!("{}/{}", Self::get_app_url(caller()), endpoint);

        let (content_type, body) = match &request.body {
            BodyTypes::Bytes(b) => (
                "application/octet-stream",
                BridgeTypes::BodyTypes::Bytes(b.clone()),
            ),
            BodyTypes::Json(j) => ("application/json", BridgeTypes::BodyTypes::Json(j.clone())),
            BodyTypes::Text(t) => ("text/plain", BridgeTypes::BodyTypes::Text(t.clone())),
        };

        let headers = vec![Header {
            key: "Content-Type".to_string(),
            value: content_type.to_string(),
        }];

        let req = HttpRequest {
            uri: url,
            method: "POST".to_string(),
            headers,
            body: Some(body),
        };

        let res = Supervisor::sync_send(&req)?;
        if res.body.is_none() {
            return Err(make_error("Http response body absent"));
        }

        Ok(res.body.unwrap().into())
    }

    fn get_json(endpoint: String) -> Result<String, Error> {
        let endpoint = endpoint.strip_prefix('/').unwrap_or(&endpoint).to_string();
        let res = get_json_request(format!("{}/{}", Self::get_app_url(caller()), endpoint))?;
        if let Some(BridgeTypes::BodyTypes::Json(body)) = res.body {
            return Ok(body);
        }

        return Err(make_error("Http response body absent or wrong type"));
    }
}

impl Client for HostCommon {
    fn get_sender_app() -> OriginationData {
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

pub struct MyPluginRef {
    pub service: String,
    pub plugin: String,
    pub intf: String,
}

fn to_camel(s: &str) -> String {
    s.split('-')
        .enumerate()
        .map(|(i, part)| {
            if i == 0 {
                part.to_string()
            } else {
                part[..1].to_uppercase() + &part[1..]
            }
        })
        .collect()
}

impl GuestPluginRef for MyPluginRef {
    fn new(service: String, plugin: String, intf: String) -> Self {
        MyPluginRef {
            service,
            plugin,
            intf: to_camel(&intf),
        }
    }

    fn get_service(&self) -> String {
        self.service.clone()
    }

    fn get_plugin(&self) -> String {
        self.plugin.clone()
    }

    fn get_intf(&self) -> String {
        self.intf.clone()
    }
}

impl Types for HostCommon {
    type PluginRef = MyPluginRef;
}

bindings::export!(HostCommon with_types_in bindings);
