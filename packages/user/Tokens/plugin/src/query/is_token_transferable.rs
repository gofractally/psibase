use crate::errors::ErrorType;
use psibase_plugin::host::server;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct Response {
    pub data: Data,
}

#[derive(Serialize, Deserialize)]
pub struct Data {
    pub token: TokenSettings,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenSettings {
    pub settings: Settings,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub untransferable: bool,
}

pub fn is_token_transferable(token_id: u32) -> Result<bool, ErrorType> {
    let query = format!(
        r#"query {{
            token(tokenId: "{token_id}") {{
                settings {{
                    untransferable
                }}
            }}
        }}"#,
        token_id = token_id
    );

    server::post_graphql_get_json(&query)
        .map_err(|e| ErrorType::QueryError(e.message))
        .and_then(|result| {
            serde_json::from_str(&result).map_err(|e| ErrorType::QueryError(e.to_string()))
        })
        .map(|response_root: Response| !response_root.data.token.settings.untransferable)
}
