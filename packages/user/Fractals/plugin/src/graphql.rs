use crate::bindings::host::types::types as HostTypes;
use crate::bindings::host::types::types::Error;
use crate::{bindings::host::common::server as CommonServer, errors::ErrorType};
use psibase::AccountNumber;
use serde::{Deserialize, Serialize};

fn fetch_guild(guild: AccountNumber) -> Result<Guild, Error> {
    let query = format!(
        r#"query {{
            guild(guild: "{}") {{
                evalInstance {{
                    evaluationId
                }}
                fractal {{
                    account
                }}
            }}
        }}"#,
        guild
    );
    Response::try_from(CommonServer::post_graphql_get_json(&query)?).map(|res| res.data.guild)
}

#[derive(Serialize, Deserialize)]
pub struct Response {
    data: Data,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Data {
    pub guild: Guild,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Guild {
    pub eval_instance: Option<EvalInstance>,
    pub fractal: Fractal,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvalInstance {
    pub evaluation_id: u32,
}

#[derive(Serialize, Deserialize)]
pub struct Fractal {
    pub account: AccountNumber,
}

impl TryFrom<String> for Response {
    type Error = HostTypes::Error;

    fn try_from(response: String) -> Result<Self, Self::Error> {
        let response_root: Response = serde_json::from_str(&response)
            .map_err(|e: serde_json::Error| ErrorType::QueryResponseParseError(format!("{}", e)))?;

        Ok(response_root)
    }
}

pub struct GuildHelper {
    pub fractal: AccountNumber,
    pub evaluation_id: Option<u32>,
}

impl From<Guild> for GuildHelper {
    fn from(value: Guild) -> Self {
        Self {
            fractal: value.fractal.account,
            evaluation_id: value.eval_instance.map(|instance| instance.evaluation_id),
        }
    }
}

pub fn get_guild(guild: String) -> Result<GuildHelper, Error> {
    fetch_guild(guild.as_str().into()).map(|guild| GuildHelper::from(guild))
}
