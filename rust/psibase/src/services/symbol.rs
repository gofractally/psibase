#![allow(non_snake_case)]
use async_graphql::{InputObject, SimpleObject};
use fracpack::{Pack, ToSchema, Unpack};
use serde::{Deserialize, Serialize};

use crate::services::nft;
use crate::services::tokens::TID;
use crate::AccountNumber;
use nft::NID;

pub type SID = AccountNumber;

#[derive(
    Debug, Copy, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
struct SymbolLength {
    symbolLength: u8,
    nftId: u32,
}

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
pub struct Mapping {
    pub tokenId: TID,
    pub symbolId: AccountNumber,
}

#[crate::service(name = "symbol", dispatch = false, psibase_mod = "crate")]
#[allow(unused_variables)]
pub mod Service {
    use crate::services::symbol::{Mapping, SymbolLength, SymbolRecord, SID};
    use crate::services::tokens::TID;
    use crate::{services::tokens::Quantity, AccountNumber};

    #[action]
    fn init() {
        unimplemented!()
    }

    #[action]
    fn create(symbol: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn admin_create(symbol: AccountNumber, recipient: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn exists(symbol: AccountNumber) -> bool {
        unimplemented!()
    }

    #[action]
    fn sellLength(length: u8, initial_price: Quantity, target: u32, floor_price: Quantity) {
        unimplemented!()
    }

    #[action]
    fn delLength(length: u8) {
        unimplemented!()
    }

    #[action]
    fn getSymbol(symbol: AccountNumber) -> SymbolRecord {
        unimplemented!()
    }

    #[action]
    fn getByToken(token_id: TID) -> Option<Mapping> {
        unimplemented!()
    }

    #[action]
    fn getMapBySym(symbol: AccountNumber) -> Option<Mapping> {
        unimplemented!()
    }

    #[action]
    fn getTokenSym(token_id: TID) -> SID {
        unimplemented!()
    }

    #[action]
    fn getPrice(length: u8) -> Quantity {
        unimplemented!()
    }

    #[action]
    fn mapSymbol(token_id: TID, symbol: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn getSymbolType(length: u8) -> SymbolLength {
        unimplemented!()
    }

    #[event(history)]
    fn symEvent(symbol: SID, actor: AccountNumber, action: u8) {
        unimplemented!()
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
