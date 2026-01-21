use crate::bindings::host::common::server;
use crate::errors::ErrorType;
use psibase::services::{
    nft::NID,
    tokens::{Decimal, TID},
};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize)]
pub struct PoolsResponse {
    pub data: PoolsData,
}

#[derive(Serialize, Deserialize)]
pub struct PoolsData {
    #[serde(rename = "allPools")]
    pub all_pools: PoolConnection,
}

#[derive(Serialize, Deserialize)]
pub struct PoolConnection {
    pub nodes: Vec<GraphQLPool>,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphQLPool {
    pub liquidity_token: TID,
    pub liquidity_token_supply: Decimal,
    pub reserve_a: Reserve,
    pub reserve_b: Reserve,
}

#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reserve {
    pub pool_id: TID,
    pub token_id: TID,
    pub fee_ppm: u32,
    pub admin_nft: NID,
    pub balance: Decimal,
}

pub fn fetch_all_pools() -> Result<Vec<GraphQLPool>, ErrorType> {
    let query = r#"
        query {
          allPools {
            nodes {
              liquidityToken
              liquidityTokenSupply
              reserveA {
                poolId
                tokenId
                feePpm
                adminNft
                balance
              }
              reserveB {
                poolId
                tokenId
                feePpm
                adminNft
                balance
              }
            }
          }
        }
    "#;

    server::post_graphql_get_json(query)
        .map_err(|e| ErrorType::QueryResponseParseError(e.message))
        .and_then(|json| {
            serde_json::from_str::<PoolsResponse>(&json)
                .map_err(|e| ErrorType::QueryError(e.to_string()))
        })
        .map(|response| response.data.all_pools.nodes)
}
