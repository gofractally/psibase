use std::str::FromStr;

use psibase::services::tokens::Decimal;

use crate::bindings::exports::token_swap::plugin::liquidity::Pool as WitPool;
use crate::graphql::GraphQLPool;

pub use psibase::services::token_swap::{find_path, GraphPool};

impl From<GraphQLPool> for GraphPool {
    fn from(value: GraphQLPool) -> Self {
        Self {
            id: value.liquidity_token,
            reserve_a: value.reserve_a.balance.quantity,
            reserve_b: value.reserve_b.balance.quantity,
            token_a: value.reserve_a.token_id,
            token_b: value.reserve_b.token_id,
            token_a_fee_ppm: value.reserve_a.fee_ppm,
            token_b_fee_ppm: value.reserve_b.fee_ppm,
        }
    }
}

impl From<WitPool> for GraphPool {
    fn from(value: WitPool) -> Self {
        Self {
            id: value.id,
            reserve_a: Decimal::from_str(&value.a_balance).unwrap().quantity,
            reserve_b: Decimal::from_str(&value.b_balance).unwrap().quantity,
            token_a: value.token_a_id,
            token_b: value.token_b_id,
            token_a_fee_ppm: value.token_a_fee_ppm,
            token_b_fee_ppm: value.token_b_fee_ppm,
        }
    }
}
