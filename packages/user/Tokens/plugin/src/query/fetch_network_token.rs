use crate::bindings::host::common::server;
use crate::errors::ErrorType;

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct Response {
    pub data: Data,
}

#[derive(Serialize, Deserialize)]
pub struct Data {
    pub config: Option<Token>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Token {
    pub sys_tid: u32,
}

pub fn fetch_network_token() -> Result<Option<u32>, ErrorType> {
    let query = format!(
        r#"query {{
        	config {{
        		sysTid
        	}}
        }}"#,
    );

    server::post_graphql_get_json(&query)
        .map_err(|e| ErrorType::QueryError(e.message))
        .and_then(|result| {
            serde_json::from_str(&result).map_err(|e| ErrorType::QueryError(e.to_string()))
        })
        .and_then(|response_root: Response| Ok(response_root.data.config))
        .and_then(|token| Ok(token.map(|token| token.sys_tid)))
}
