#[derive(Debug, PartialEq)]
pub enum ConversionError {
    InvalidNumber,
    PrecisionOverflow,
}

pub fn convert_to_u64(
    number: &str,
    precision: u8,
    validate_precision: bool,
) -> Result<u64, ConversionError> {
    let parts: Vec<&str> = number.split('.').collect();

    if parts.len() > 2 {
        return Err(ConversionError::InvalidNumber);
    }

    let integer_part: u64 = parts[0]
        .parse()
        .map_err(|_| ConversionError::InvalidNumber)?;

    let fractional_value: u64 = if parts.len() > 1 {
        let fraction = parts[1]
            .chars()
            .take(precision as usize)
            .collect::<String>();

        if validate_precision {
            if (parts[1].len() as u8) > precision {
                return Err(ConversionError::PrecisionOverflow);
            };
        }

        let remaining_precision = precision - (fraction.len() as u8);
        let fraction_num: u64 = fraction.parse().expect("expected number");
        fraction_num * (10 as u64).pow(remaining_precision as u32)
    } else {
        0
    };

    let integer_value = integer_part * (10 as u64).pow(precision as u32);

    return Ok(integer_value + fractional_value);
}

use async_graphql::{InputObject, SimpleObject};
use fracpack::{Pack, ToSchema, Unpack};
use serde::{Deserialize, Serialize};

use crate::AccountNumber;

#[derive(
    Debug, Copy, Clone, Pack, Unpack, Serialize, Deserialize, ToSchema, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[graphql(input_name = "PrecisionInput")]
pub struct Precision {
    pub value: u8,
}

impl From<u8> for Precision {
    fn from(value: u8) -> Self {
        Precision { value }
    }
}

#[derive(
    Debug, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[graphql(input_name = "MemoInput")]
pub struct Memo {
    pub contents: String,
}

#[derive(
    Debug, Copy, Clone, Pack, Unpack, ToSchema, Serialize, Deserialize, SimpleObject, InputObject,
)]
#[fracpack(fracpack_mod = "fracpack")]
#[graphql(input_name = "QuantityInput")]
pub struct Quantity {
    pub value: u64,
}

impl Quantity {
    pub fn new(value: &str, precision: u8) -> Self {
        Quantity {
            value: convert_to_u64(value, precision, false).expect("failed to parse"),
        }
    }
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
    fn get_token_by_symbol(symbol: AccountNumber) -> Option<TokenRecord> {
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
