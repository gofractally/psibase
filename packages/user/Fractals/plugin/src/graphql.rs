pub mod guild {
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
                            councilRole
                            repRole
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
        pub council_role: AccountNumber,
        pub rep_role: AccountNumber,
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
            let response_root: Response =
                serde_json::from_str(&response).map_err(|e: serde_json::Error| {
                    ErrorType::QueryResponseParseError(format!("{}", e))
                })?;

            Ok(response_root)
        }
    }

    pub struct GuildHelper {
        pub fractal: AccountNumber,
        pub evaluation_id: Option<u32>,
        pub council_role: AccountNumber,
        pub rep_role: AccountNumber,
    }

    impl From<Guild> for GuildHelper {
        fn from(value: Guild) -> Self {
            Self {
                council_role: value.council_role,
                rep_role: value.rep_role,
                fractal: value.fractal.account,
                evaluation_id: value.eval_instance.map(|instance| instance.evaluation_id),
            }
        }
    }

    pub fn get_guild(guild: String) -> Result<GuildHelper, Error> {
        fetch_guild(guild.as_str().into()).map(|guild| GuildHelper::from(guild))
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
    pub struct Response {
        data: Data,
    }

    #[derive(Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct Data {
        pub fractal: FractalData,
    }

    #[derive(Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct FractalData {
        pub account: AccountNumber,
        pub legislature: GuildRef,
        pub judiciary: GuildRef,
    }

    #[derive(Serialize, Deserialize)]
    #[serde(rename_all = "camelCase")]
    pub struct GuildRef {
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

    pub struct FractalHelper {
        pub account: AccountNumber,
        pub legislature: AccountNumber,
        pub judiciary: AccountNumber,
    }

    impl From<FractalData> for FractalHelper {
        fn from(value: FractalData) -> Self {
            Self {
                account: value.account,
                legislature: value.legislature.account,
                judiciary: value.judiciary.account,
            }
        }
    }

    pub fn get_fractal(fractal: String) -> Result<FractalHelper, Error> {
        fetch_fractal(fractal.as_str().into()).map(|data| FractalHelper::from(data))
    }
}
