use async_graphql::{InputObject, SimpleObject};
use fracpack::{Pack, ToSchema, Unpack};
use serde::{Deserialize, Serialize};

use crate::{services::nft::NID, AccountNumber, Quantity};

type SID = AccountNumber;

#[derive(
    Debug, Copy, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct SaleDetails {
    #[allow(non_snake_case)]
    pub salePrice: Quantity,

    pub seller: AccountNumber,
}

#[derive(
    Debug, Copy, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct SymbolRecord {
    #[allow(non_snake_case)]
    pub symbolId: SID,
    #[allow(non_snake_case)]
    pub ownerNft: NID,
    #[allow(non_snake_case)]
    pub saleDetails: SaleDetails,
}

#[crate::service(name = "symbol", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
pub mod Service {
    use crate::services::symbol::SymbolRecord;
    use crate::{AccountNumber, Quantity};

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
}
