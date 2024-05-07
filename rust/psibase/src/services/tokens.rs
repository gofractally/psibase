use async_graphql::{InputObject, SimpleObject};
use fracpack::{Pack, Unpack};
use serde::{Deserialize, Serialize};

use crate::{AccountNumber, Reflect};

pub type NID = u32;

#[derive(
    Debug, Copy, Clone, Pack, Unpack, Reflect, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[graphql(input_name = "PrecisionInput")]
pub struct Precision {
    pub value: u8,
}

#[derive(
    Debug, Clone, Pack, Unpack, Reflect, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[graphql(input_name = "MemoInput")]
pub struct Memo {
    pub contents: String,
}

#[derive(
    Debug, Copy, Clone, Pack, Unpack, Reflect, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[reflect(psibase_mod = "crate")]
#[graphql(input_name = "QuantityInput")]
pub struct Quantity {
    pub value: u64,
}

pub type TID = u32;

#[crate::service(name = "tokens", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {

    use super::{Memo, Precision, Quantity, TID};
    use crate::AccountNumber;

    #[action]
    fn init() {
        unimplemented!()
    }

    #[action]
    fn credit(tokenId: TID, receiver: AccountNumber, amount: Quantity, memo: String) {
        unimplemented!()
    }

    #[action]
    fn create(precision: Precision, maxSupply: Quantity) {
        unimplemented!()
    }

    #[action]
    fn burn(tokenId: TID, amount: Quantity) {
        unimplemented!()
    }

    #[action]
    fn mint(tokenId: TID, amount: Quantity, memo: Memo) {
        unimplemented!()
    }
}
