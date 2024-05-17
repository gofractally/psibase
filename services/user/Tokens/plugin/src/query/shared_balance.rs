use crate::bindings::common::plugin::{client, server, types as CommonTypes};
use serde::Deserialize;

use crate::errors::ErrorType::*;

#[allow(non_snake_case, dead_code)]
#[derive(Deserialize)]
pub struct Key {
    pub creditor: String,
    pub debitor: String,
    pub tokenId: u32,
}

#[allow(non_snake_case, dead_code)]
#[derive(Deserialize)]
pub struct Balance {
    pub key: Key,
    pub balance: String,
}

#[allow(non_snake_case, dead_code)]
#[derive(Deserialize)]
pub struct Node<T> {
    pub node: T,
}

#[allow(non_snake_case, dead_code)]
#[derive(Deserialize)]
pub struct Edge {
    pub edges: Vec<Node<Balance>>,
}

#[allow(non_snake_case)]
#[derive(Deserialize)]
pub struct Data {
    pub sharedBalances: Edge,
}

#[derive(Deserialize)]
pub struct ResponseRoot {
    pub data: Data,
}

pub fn fetch_balances() -> Result<Vec<Balance>, CommonTypes::Error> {
    let url: String = format!(
        "{}/graphql",
        client::my_service_origin().expect("origin failure")
    );

    let query = format!(
        r#"query {{
            sharedBalances(first: 500) {{
                edges {{
                    node {{
                        balance
                        key {{
                            creditor,
                            debitor,
                            tokenId
                        }}
                    }}
                }}
            }}
        }}
        "#,
    );

    server::post_graphql_get_json(&url, &query)
        .map_err(|e| QueryError.err(&e.message))
        .and_then(|result| {
            serde_json::from_str(&result).map_err(|e| QueryError.err(&e.to_string()))
        })
        .and_then(|response_root: ResponseRoot| Ok(response_root.data.sharedBalances.edges))
        .and_then(|edges| Ok(edges.into_iter().map(|edge| edge.node).collect()))
}
