pub mod guild {
    use crate::bindings::exports::guilds::plugin::queries::Guild as GuildWit;
    use crate::bindings::host::types::types as HostTypes;
    use crate::bindings::host::types::types::Error;
    use crate::{bindings::host::common::server as CommonServer, errors::ErrorType};
    use psibase::AccountNumber;
    use serde::{Deserialize, Serialize};

    fn fetch_guild(guild: AccountNumber) -> Result<GuildQuery, Error> {
        let query = format!(
            r#"query {{
                guild(account: "{}") {{
                    evalInstance {{
                        evaluationId
                    }}
                    account
                    owner
                    councilRole
                        repRole
                    }}
                }}"#,
            guild
        );
        Response::try_from(CommonServer::post_graphql_get_json(&query)?)
            .map(|res| res.data.guild.expect("expected a guild to be here"))
    }

    #[derive(Serialize, Deserialize)]
    struct Response {
        data: Data,
    }

    #[derive(Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Data {
        pub guild: Option<GuildQuery>,
    }

    #[derive(Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GuildQuery {
        pub eval_instance: Option<EvalInstance>,
        pub owner: AccountNumber,
        pub account: AccountNumber,
        pub council_role: AccountNumber,
        pub rep_role: AccountNumber,
    }

    #[derive(Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct EvalInstance {
        pub evaluation_id: u32,
    }

    impl TryFrom<String> for Response {
        type Error = HostTypes::Error;

        fn try_from(response: String) -> Result<Self, Self::Error> {
            let response_root: Response =
                serde_json::from_str(&response).map_err(|e: serde_json::Error| {
                    ErrorType::QueryResponseParseError(format!("{}", e))
                })?;

            Ok(response_root)
        }
    }

    pub struct Guild {
        pub fractal: AccountNumber,
        pub guild: AccountNumber,
        pub evaluation_id: Option<u32>,
        pub council_role: AccountNumber,
        pub rep_role: AccountNumber,
    }

    impl From<GuildQuery> for Guild {
        fn from(value: GuildQuery) -> Self {
            Self {
                council_role: value.council_role,
                rep_role: value.rep_role,
                guild: value.account,
                fractal: value.owner,
                evaluation_id: value.eval_instance.map(|instance| instance.evaluation_id),
            }
        }
    }

    pub fn get_guild(guild: String) -> Result<Guild, Error> {
        fetch_guild(guild.as_str().into()).map(|guild| Guild::from(guild))
    }

    impl From<Guild> for GuildWit {
        fn from(value: Guild) -> Self {
            Self {
                council_role: value.council_role.to_string(),
                evaluation_id: value.evaluation_id,
                fractal: value.fractal.to_string(),
                guild: value.guild.to_string(),
                rep_role: value.rep_role.to_string(),
            }
        }
    }
}
