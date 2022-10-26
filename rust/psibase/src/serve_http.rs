use crate::{
    create_schema, generate_action_templates, reflect::Reflect, HttpReply, HttpRequest,
    ProcessActionStruct, WithActionStruct,
};
use serde_json::to_vec;

const SIMPLE_UI: &[u8] = br#"<html><div id="root" class="ui container"></div><script src="/common/SimpleUI.mjs" type="module"></script></html>"#;

pub fn serve_simple_ui<Wrapper: Reflect + WithActionStruct>(
    request: &HttpRequest,
) -> Option<HttpReply> {
    None.or_else(|| serve_simple_index(request))
        .or_else(|| serve_schema::<Wrapper>(request))
        .or_else(|| serve_action_templates::<Wrapper>(request))
        .or_else(|| serve_pack_action::<Wrapper>(request))
}

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

pub fn serve_pack_action<T: WithActionStruct>(request: &HttpRequest) -> Option<HttpReply> {
    struct PackAction<'a>(&'a [u8]);

    impl<'a> ProcessActionStruct for PackAction<'a> {
        type Output = HttpReply;

        fn process<
            Return: Reflect + fracpack::PackableOwned + serde::Serialize + serde::de::DeserializeOwned,
            ArgStruct: Reflect + fracpack::PackableOwned + serde::Serialize + serde::de::DeserializeOwned,
        >(
            self,
        ) -> Self::Output {
            HttpReply {
                contentType: "application/octet-stream".into(),
                body: serde_json::from_slice::<ArgStruct>(self.0)
                    .unwrap()
                    .packed(),
                headers: vec![],
            }
        }
    }

    if request.method == "POST" && request.target.starts_with("/pack_action/") {
        T::with_action_struct(&request.target[13..], PackAction(&request.body))
    } else {
        None
    }
}
