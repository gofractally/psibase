use crate::bindings::host::types::types as HostTypes;
use crate::bindings::host::types::types::Error;
use crate::{bindings::host::common::server as CommonServer, errors::ErrorType};
use serde::{Deserialize, Serialize};

pub fn fetch_config() -> Result<Config, Error> {
    let query = format!(
        r#"query {{
            config {{
                billingToken
            }}
        }}"#,
    );
    Ok(
        Response::try_from(CommonServer::post_graphql_get_json(&query)?)?
            .data
            .config
            .ok_or(ErrorType::ConfigNotInitialized)?,
    )
}

#[derive(Serialize, Deserialize)]
pub struct Response {
    pub data: Data,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Config {
    pub billing_token: u32,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Data {
    pub config: Option<Config>,
}

impl TryFrom<String> for Response {
    type Error = HostTypes::Error;

    fn try_from(response: String) -> Result<Self, Self::Error> {
        let response_root: Response = serde_json::from_str(&response)
            .map_err(|e: serde_json::Error| ErrorType::QueryResponseParseError(format!("{}", e)))?;

        Ok(response_root)
    }
}
