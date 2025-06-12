use async_graphql::{InputObject, SimpleObject};
use fracpack::{Pack, ToSchema, Unpack};
use serde::{Deserialize, Serialize};

use crate::{AccountNumber, Quantity};

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
    pub symbolId: AccountNumber,
    #[allow(non_snake_case)]
    pub ownerNft: AccountNumber,
    #[allow(non_snake_case)]
    pub saleDetails: SaleDetails,
}

#[crate::service(
    name = "symbol-hooks",
    actions = "hooks_actions",
    wrapper = "hooks_wrapper",
    structs = "hooks_structs",
    dispatch = false,
    pub_constant = false,
    psibase_mod = "crate"
)]
#[allow(non_snake_case, unused_variables)]
pub mod Hooks {
    use crate::AccountNumber;

    #[action]
    fn evalRegister(evaluation_id: u32, account: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn evalUnregister(evaluation_id: u32, account: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn evalGroupFin(evaluation_id: u32, group_number: u32, result: Vec<u8>) {
        unimplemented!()
    }
}

#[crate::service(name = "symbol", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
pub mod Service {
    use crate::services::symbol::SymbolRecord;
    use crate::{AccountNumber, Quantity};

    #[action]
    fn create(new_symbol: AccountNumber, max_debit: Quantity) -> u32 {
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
