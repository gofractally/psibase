use crate::{create_schema, generate_action_templates, reflect::Reflect, HttpReply, HttpRequest};
use serde_json::to_vec;

const SIMPLE_UI: &[u8] = br#"<html><div id="root" class="ui container"></div><script src="/common/SimpleUI.mjs" type="module"></script></html>"#;

pub fn serve_simple_index(request: &HttpRequest) -> Option<HttpReply> {
    if request.method == "GET" && (request.target == "/" || request.target == "/index.html") {
        Some(HttpReply {
            contentType: "text/html".into(),
            body: SIMPLE_UI.to_vec(),
            headers: vec![],
        })
    } else {
        None
    }
}

pub fn serve_schema<T: Reflect>(request: &HttpRequest) -> Option<HttpReply> {
    if request.method == "GET" && request.target == "/schema" {
        Some(HttpReply {
            contentType: "text/html".into(),
            body: to_vec(&create_schema::<T>()).unwrap(),
            headers: vec![],
        })
    } else {
        None
    }
}

pub fn serve_action_templates<T: Reflect>(request: &HttpRequest) -> Option<HttpReply> {
    if request.method == "GET" && request.target == "/action_templates" {
        Some(HttpReply {
            contentType: "text/html".into(),
            body: generate_action_templates::<T>().into(),
            headers: vec![],
        })
    } else {
        None
    }
}
