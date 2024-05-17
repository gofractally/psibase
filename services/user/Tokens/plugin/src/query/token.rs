use crate::bindings::common::plugin::{client, server, types as CommonTypes};
use serde::Deserialize;

use crate::errors::ErrorType::*;

#[allow(non_snake_case, dead_code)]
#[derive(Deserialize)]
pub struct Wrap<T> {
    pub value: T,
}

#[allow(non_snake_case, dead_code)]
#[derive(Deserialize)]
pub struct Token {
    pub id: u64,
    pub precision: Wrap<u8>,
    pub symbolId: String,
}

#[allow(non_snake_case, dead_code)]
#[derive(Deserialize)]
pub struct Node<T> {
    pub node: T,
}

#[allow(non_snake_case, dead_code)]
#[derive(Deserialize)]
pub struct Edge {
    pub edges: Vec<Node<Token>>,
}

#[allow(non_snake_case)]
#[derive(Deserialize)]
pub struct Data {
    pub tokens: Edge,
}

#[derive(Deserialize)]
pub struct ResponseRoot {
    pub data: Data,
}

pub fn fetch_precision(token: u32) -> Result<u8, CommonTypes::Error> {
    let url = format!(
        "{}/graphql",
        client::my_service_origin().expect("origin failure")
    );

    let query = format!(
        r#"query {{
            tokens(ge: {token}, le: {token}) {{
                edges {{
                    node {{
                        id
                        precision {{
                            value
                        }}
                        symbolId
                    }}
                }}
            }}
        }}"#,
        token = token
    );

    server::post_graphql_get_json(&url, &query)
        .map_err(|e| QueryError.err(&e.message))
        .and_then(|result| {
            serde_json::from_str(&result).map_err(|e| QueryError.err(&e.to_string()))
        })
        .and_then(|response_root: ResponseRoot| Ok(response_root.data.tokens.edges))
        .and_then(|res| Ok(res[0].node.precision.value))
}
