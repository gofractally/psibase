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
    use crate::services::symbol::{SymbolLengthRecord, SymbolRecord, SID};
    use crate::{services::tokens::Quantity, AccountNumber, HttpReply, HttpRequest};

    #[action]
    fn init() {
        unimplemented!()
    }

    #[action]
    fn create(new_symbol: AccountNumber, max_debit: Quantity) {
        unimplemented!()
    }

    #[action]
    fn listSymbol(symbol: AccountNumber, price: Quantity) {
        unimplemented!()
    }

    #[action]
    fn buySymbol(symbol: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn unlistSymbol(symbol: AccountNumber) {
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
    fn getPrice(num_chars: u8) -> Quantity {
        unimplemented!()
    }

    #[action]
    fn updatePrices() {
        unimplemented!()
    }

    #[action]
    fn getSymbolType(numChars: u8) -> SymbolLengthRecord {
        unimplemented!()
    }

    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        unimplemented!()
    }

    #[event(history)]
    fn symCreated(symbol: SID, owner: AccountNumber, cost: Quantity) {
        unimplemented!()
    }
    #[event(history)]
    fn symSold(symbol: SID, buyer: AccountNumber, seller: AccountNumber, cost: Quantity) {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
