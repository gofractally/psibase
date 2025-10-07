use crate::bindings::host::types::types as HostTypes;
use crate::bindings::host::types::types::Error;
use crate::{bindings::host::common::server as CommonServer, errors::ErrorType};
use psibase::AccountNumber;
use serde::{Deserialize, Serialize};

pub fn fetch_guild_eval_instance(guild: AccountNumber) -> Result<Option<u32>, Error> {
    let query = format!(
        r#"query {{
            guild(guild: "{}") {{
                evalInstance {{
                    evaluationId
                }}
            }}
        }}"#,
        guild
    );
    Response::try_from(CommonServer::post_graphql_get_json(&query)?).map(|res| {
        res.data
            .guild
            .eval_instance
            .map(|instance| instance.evaluation_id)
    })
}

#[derive(Serialize, Deserialize)]
pub struct Response {
    data: Data,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Data {
    guild: Guild,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Guild {
    eval_instance: Option<EvalInstance>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvalInstance {
    evaluation_id: u32,
}

impl TryFrom<String> for Response {
    type Error = HostTypes::Error;

    fn try_from(response: String) -> Result<Self, Self::Error> {
        let response_root: Response = serde_json::from_str(&response)
            .map_err(|e: serde_json::Error| ErrorType::QueryResponseParseError(format!("{}", e)))?;

        Ok(response_root)
    }
}
