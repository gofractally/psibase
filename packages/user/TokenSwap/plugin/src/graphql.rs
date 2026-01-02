use crate::bindings::host::common::server;
use crate::errors::ErrorType;
use psibase::services::tokens::Decimal;
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
    pub id: u32,
    pub token_a_id: u32,
    pub token_b_id: u32,
    pub token_a_tariff_ppm: u32,
    pub token_b_tariff_ppm: u32,
    pub a_balance: Decimal,
    pub b_balance: Decimal,
}

pub fn fetch_all_pools() -> Result<Vec<GraphQLPool>, ErrorType> {
    let query = r#"
        query {
          allPools {
            nodes {
              id
              tokenAId
              tokenBId
              tokenATariffPpm
              tokenBTariffPpm
              aBalance
              bBalance
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
