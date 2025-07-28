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

#[derive(
    Debug, Copy, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct SymbolLengthRecord {
    pub symbolLength: u8,
    pub targetCreatedPerDay: u8,
    pub floorPrice: Quantity,
    pub activePrice: Quantity,
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
