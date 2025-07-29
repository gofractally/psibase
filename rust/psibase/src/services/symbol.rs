#![allow(non_snake_case)]
use async_graphql::{InputObject, SimpleObject};
use fracpack::{Pack, ToSchema, Unpack};
use serde::{Deserialize, Serialize};

use crate::services::{nft, tokens};
use crate::AccountNumber;
use nft::NID;
use tokens::Quantity;

pub type SID = AccountNumber;

#[derive(
    Debug, Copy, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct SymbolRecord {
    pub symbolId: SID,
    pub ownerNft: NID,
}

#[derive(
    Debug, Copy, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct SymbolLengthRecord {
    pub symbol_length: u8,
    pub target_created_per_day: u8,
    pub floor_price: Quantity,
    pub active_price: Quantity,
    pub create_counter: u16,
    pub last_price_update_time: crate::TimePointSec,
}

#[crate::service(name = "symbol", dispatch = false, psibase_mod = "crate")]
#[allow(unused_variables)]
pub mod Service {
    use crate::services::symbol::{SymbolLengthRecord, SymbolRecord};
    use crate::{services::tokens::Quantity, AccountNumber};

    #[action]
    fn create(new_symbol: AccountNumber, max_debit: Quantity) {
        unimplemented!()
    }

    #[action]
    fn exists(symbol: AccountNumber) -> bool {
        unimplemented!()
    }

    #[action]
    fn getSymbol(symbol: AccountNumber) -> SymbolRecord {
        unimplemented!()
    }

    #[action]
    fn getSymType(numChars: u8) -> SymbolLengthRecord {
        unimplemented!()
    }

    #[action]
    fn updatePrices() {
        unimplemented!()
    }
}
