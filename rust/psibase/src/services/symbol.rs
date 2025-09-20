#![allow(non_snake_case)]
use async_graphql::{InputObject, SimpleObject};
use fracpack::{Pack, ToSchema, Unpack};
use serde::{Deserialize, Serialize};

use crate::services::{nft, tokens};
use crate::{AccountNumber, BlockTime};
use nft::NID;
use tokens::Quantity;

pub type SID = AccountNumber;

#[derive(
    Debug, Copy, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
struct SymbolLengthRecord {
    symbolLength: u8,
    targetCreatedPerDay: u8,
    floorPrice: Quantity,
    activePrice: Quantity,

    createCounter: u8,
    lastPriceUpdateTime: BlockTime,
}

#[derive(
    Debug, Copy, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct SaleDetails {
    pub salePrice: Quantity,

    pub seller: AccountNumber,
}

#[derive(
    Debug, Copy, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct SymbolRecord {
    pub symbolId: SID,
    pub ownerNft: NID,
    pub saleDetails: SaleDetails,
}

#[crate::service(name = "symbol", dispatch = false, psibase_mod = "crate")]
#[allow(unused_variables)]
pub mod Service {
    use crate::{services::tokens::Quantity, AccountNumber};

    /// Purchase a symbol
    ///
    /// # Arguments
    /// * `symbol` - Symbol to purchase
    #[action]
    fn purchase(symbol: AccountNumber) -> u32 {
        unimplemented!()
    }

    /// Start sale
    ///
    /// # Arguments
    /// * `len` - Length of symbols to sell
    /// * `initial_cost` - Initial cost of symbol length
    /// * `window_seconds` - Window seconds before decay
    /// * `target_min` - Minimum rate limit target
    /// * `target_max` - Maximum rate limit target
    /// * `floor_cost` - Minimum price of symbol length
    /// * `percent_change` - Percent to increment / decrement, 50000 = 5%
    #[action]
    fn start_sale(
        len: u8,
        initial_price: Quantity,
        window_seconds: u32,
        target_min: u32,
        target_max: u32,
        floor_price: Quantity,
        percent_change: u32,
    ) {
        unimplemented!()
    }

    /// Get Token ID
    ///
    /// # Arguments
    /// * `symbol` - Symbol to lookup by
    ///
    /// # Returns
    /// Option of Token ID, none if not mapped
    #[action]
    fn get_token_id(symbol: AccountNumber) -> Option<u32> {
        unimplemented!()
    }

    #[event(history)]
    pub fn purchased(symbol: AccountNumber, actor: AccountNumber) {}

    #[event(history)]
    pub fn mapped(symbol: AccountNumber, token_id: u32) {}
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
