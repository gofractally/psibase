pub mod guild {
    use crate::bindings::host::types::types as HostTypes;
    use crate::bindings::host::types::types::Error;
    use crate::{bindings::host::common::server as CommonServer, errors::ErrorType};
    use psibase::AccountNumber;
    use serde::{Deserialize, Serialize};

    fn fetch_guild(guild: AccountNumber) -> Result<GuildQuery, Error> {
        let query = format!(
            r#"query {{
                guild(guild: "{}") {{
                    evalInstance {{
                        evaluationId
                    }}
                    account
                    fractal {{
                        account
                    }}

                    councilRole
                        repRole
                    }}
                }}"#,
            guild
        );
        Response::try_from(CommonServer::post_graphql_get_json(&query)?).map(|res| res.data.guild)
    }

    #[derive(Serialize, Deserialize)]
    struct Response {
        data: Data,
    }

    #[derive(Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Data {
        pub guild: GuildQuery,
    }

    #[derive(Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GuildQuery {
        pub eval_instance: Option<EvalInstance>,
        pub fractal: AccountItem,
        pub account: AccountNumber,
        pub council_role: AccountNumber,
        pub rep_role: AccountNumber,
    }

    #[derive(Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct EvalInstance {
        pub evaluation_id: u32,
    }

    #[derive(Serialize, Deserialize)]
    struct AccountItem {
        pub account: AccountNumber,
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
                fractal: value.fractal.account,
                evaluation_id: value.eval_instance.map(|instance| instance.evaluation_id),
            }
        }
    }

    pub fn get_guild(guild: String) -> Result<Guild, Error> {
        fetch_guild(guild.as_str().into()).map(|guild| Guild::from(guild))
    }
}
pub mod fractal {
    use crate::bindings::host::types::types as HostTypes;
    use crate::bindings::host::types::types::Error;
    use crate::{bindings::host::common::server as CommonServer, errors::ErrorType};
    use psibase::AccountNumber;
    use serde::{Deserialize, Serialize};

    fn fetch_fractal(fractal: AccountNumber) -> Result<FractalData, Error> {
        let query = format!(
            r#"query {{
                fractal(fractal: "{}") {{
                    account
                    tokenId
                    legislature {{
                        account
                    }}
                    judiciary {{
                        account
                    }}
                }}
            }}"#,
            fractal
        );
        Response::try_from(CommonServer::post_graphql_get_json(&query)?).map(|res| res.data.fractal)
    }

    #[derive(Serialize, Deserialize)]
    struct Response {
        data: Data,
    }

    #[derive(Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Data {
        pub fractal: FractalData,
    }

    #[derive(Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct FractalData {
        pub account: AccountNumber,
        pub token_id: u32,
        pub legislature: GuildRef,
        pub judiciary: GuildRef,
    }

    #[derive(Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct GuildRef {
        pub account: AccountNumber,
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

    pub struct Fractal {
        pub account: AccountNumber,
        pub token_id: u32,
        pub legislature: AccountNumber,
        pub judiciary: AccountNumber,
    }

    impl From<FractalData> for Fractal {
        fn from(value: FractalData) -> Self {
            Self {
                account: value.account,
                token_id: value.token_id,
                legislature: value.legislature.account,
                judiciary: value.judiciary.account,
            }
        }
    }

    pub fn get_fractal(fractal: String) -> Result<Fractal, Error> {
        fetch_fractal(fractal.as_str().into()).map(|data| Fractal::from(data))
    }
}
