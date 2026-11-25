use crate::bindings::host::http::api as server;
use crate::errors::ErrorType;
use psibase::services::tokens::Precision;
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
struct Response {
    data: Data,
}

#[derive(Serialize, Deserialize)]
struct Data {
    asset: Option<Asset>,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct Asset {
    pub id: u16,
    pub symbol: String,
    pub precision: u8,
    pub description: String,
}

impl Asset {
    pub fn precision(&self) -> Result<Precision, ErrorType> {
        Precision::new(self.precision).map_err(|e| ErrorType::ConversionError(e.to_string()))
    }
}

/// Load asset metadata from Banx GraphQL (`POST /graphql` on this app).
pub fn fetch_asset(asset_id: u16) -> Result<Asset, ErrorType> {
    let query = format!(
        r#"query {{
            asset(id: {asset_id}) {{
                id
                symbol
                precision
                description
            }}
        }}"#
    );

    let result =
        server::post_graphql_get_json(&query).map_err(|e| ErrorType::QueryError(e.message))?;

    let response: Response =
        serde_json::from_str(&result).map_err(|e| ErrorType::QueryError(e.to_string()))?;

    let asset = response
        .data
        .asset
        .ok_or_else(|| ErrorType::AssetNotFound(asset_id.to_string()))?;

    if asset.id != asset_id {
        return Err(ErrorType::AssetNotFound(asset_id.to_string()));
    }

    Ok(asset)
}

#[derive(Serialize, Deserialize)]
struct PrecResponse {
    data: PrecData,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PrecData {
    token_precision: u8,
}

/// Tokens precision via Banx GraphQL (`tokenPrecision`).
pub fn fetch_token_precision(token_id: u32) -> Result<Precision, ErrorType> {
    let query = format!(
        r#"query {{
            tokenPrecision(tokenId: {token_id})
        }}"#
    );
    let result =
        server::post_graphql_get_json(&query).map_err(|e| ErrorType::QueryError(e.message))?;
    let response: PrecResponse =
        serde_json::from_str(&result).map_err(|e| ErrorType::QueryError(e.to_string()))?;
    Precision::new(response.data.token_precision)
        .map_err(|e| ErrorType::ConversionError(e.to_string()))
}
