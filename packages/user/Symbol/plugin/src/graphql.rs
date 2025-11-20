use crate::bindings::host::types::types as HostTypes;
use crate::bindings::host::types::types::Error;
use crate::{bindings::host::common::server as CommonServer, errors::ErrorType};
use psibase::services::tokens::TID;
use psibase::AccountNumber;
use serde::{Deserialize, Serialize};

pub fn fetch_symbol_owner_nft(symbol: AccountNumber) -> Result<TID, Error> {
    let query = format!(
        r#"query {{
            symbol(symbol: "{}") {{
                ownerNft {{
                    id
                }}
            }}
        }}"#,
        symbol
    );

    Ok(
        SymbolOwnerRes::try_from(CommonServer::post_graphql_get_json(&query)?)
            .map_err(|error| ErrorType::QueryResponseParseError(error.message))?
            .data
            .symbol
            .ok_or(ErrorType::SymbolDoesNotExist)?
            .owner_nft
            .id,
    )
}

#[derive(Serialize, Deserialize)]
pub struct SymbolOwnerRes {
    pub data: SymbolData,
}

#[derive(Serialize, Deserialize)]
pub struct SymbolData {
    pub symbol: Option<Symbol>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Symbol {
    pub owner_nft: OwnerNft,
}

#[derive(Serialize, Deserialize)]
pub struct OwnerNft {
    pub id: TID,
}

impl TryFrom<String> for SymbolOwnerRes {
    type Error = HostTypes::Error;

    fn try_from(response: String) -> Result<Self, Self::Error> {
        let response_root: SymbolOwnerRes = serde_json::from_str(&response)
            .map_err(|e: serde_json::Error| ErrorType::QueryResponseParseError(e.to_string()))?;

        Ok(response_root)
    }
}
