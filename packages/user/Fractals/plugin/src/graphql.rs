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
