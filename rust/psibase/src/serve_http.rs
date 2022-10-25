use crate::{generate_template, reflect::Reflect, HttpReply, HttpRequest};

const SIMPLE_UI: &[u8] = br#"<html><div id="root" class="ui container"></div><script src="/common/SimpleUI.mjs" type="module"></script></html>"#;

pub fn serve_simple_ui(include_root: bool, request: &HttpRequest) -> Option<HttpReply> {
    if include_root && request.method == "GET" && request.target == "/" {
        Some(HttpReply {
            contentType: "text/html".into(),
            body: SIMPLE_UI.to_vec(),
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
            body: generate_template::<T>().into(),
            headers: vec![],
        })
    } else {
        None
    }
}
