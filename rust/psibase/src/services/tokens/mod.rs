pub mod decimal;
pub mod precision;
pub mod quantity;

pub use decimal::Decimal;
pub use precision::Precision;
pub use quantity::Quantity;

use async_graphql::{InputObject, SimpleObject};
use custom_error::custom_error;
use fracpack::{Pack, ToSchema, Unpack};

use serde::{Deserialize, Serialize};

use crate::AccountNumber;

custom_error! { pub ConversionError
    InvalidNumber = "Invalid Number",
    PrecisionOverflow = "Precision overflow",
    Overflow = "Overflow",
}

#[derive(
    Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[graphql(input_name = "MemoInput")]
pub struct Memo {
    pub contents: String,
}

pub type TID = u32;

#[derive(
    Debug, Copy, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct TokenRecord {
    pub id: TID,
    pub nft_id: u32,
    pub settings_value: u8,
    pub precision: Precision,
    pub current_supply: Quantity,
    pub max_supply: Quantity,
    pub symbol: AccountNumber,
}

#[derive(
    Debug, Copy, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct TokenHolder {
    pub account: AccountNumber,
    pub token_id: TID,
    pub flags: u8,
}

#[derive(
    Debug, Copy, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct Holder {
    pub account: AccountNumber,
    pub flags: u8,
}

#[derive(
    Debug, Copy, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct SharedBalance {
    pub creditor: AccountNumber,
    pub debitor: AccountNumber,
    pub token_id: TID,
    pub balance: Quantity,
}

#[derive(
    Debug, Copy, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct Balance {
    pub account: AccountNumber,
    pub token_id: TID,
    pub balance: Quantity,
}

#[crate::service(name = "tokens", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {

    use super::{
        Balance, Holder, Precision, Quantity, SharedBalance, TokenHolder, TokenRecord, TID,
    };
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
    fn uncredit(tokenId: TID, receiver: AccountNumber, maxAmount: Quantity, memo: String) {
        unimplemented!()
    }

    #[action]
    fn debit(tokenId: TID, sender: AccountNumber, amount: Quantity, memo: String) {
        unimplemented!()
    }

    #[action]
    fn create(max_supply: Quantity, precision: Precision) -> TID {
        unimplemented!()
    }

    #[action]
    fn burn(tokenId: TID, amount: Quantity) {
        unimplemented!()
    }

    #[action]
    fn mint(tokenId: TID, amount: Quantity, memo: String) {
        unimplemented!()
    }

    #[action]
    fn recall(tokenId: TID, from: AccountNumber, amount: Quantity, memo: String) {
        unimplemented!()
    }

    #[action]
    #[allow(non_snake_case)]
    fn getToken(token_id: TID) -> TokenRecord {
        unimplemented!()
    }

    #[action]
    fn map_symbol(token_id: TID, symbol: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn getUserConf(account: AccountNumber) -> Holder {
        unimplemented!()
    }

    #[action]
    fn setUserConf(index: u8, enabled: bool) {
        unimplemented!()
    }

    #[action]
    fn getTokHoldr(account: AccountNumber, token_id: TID) -> TokenHolder {
        unimplemented!()
    }

    #[action]
    fn setBalConf(token_id: TID, index: u8, enabled: bool) {
        unimplemented!()
    }

    #[action]
    fn setTokenConf(token_id: TID, index: u8, enabled: bool) {
        unimplemented!()
    }

    #[action]
    fn open(token_id: TID) {
        unimplemented!()
    }

    #[action]
    fn getBalance(token_id: TID, user: AccountNumber) -> Balance {
        unimplemented!()
    }

    #[action]
    fn getSharedBal(
        creditor: AccountNumber,
        debitor: AccountNumber,
        token_id: TID,
    ) -> SharedBalance {
        unimplemented!()
    }
}
