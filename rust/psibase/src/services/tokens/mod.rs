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

custom_error! { pub TokensError
    InvalidNumber = "Invalid Number",
    PrecisionOverflow = "Precision overflow",
    Overflow = "Overflow",
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
    pub issued_supply: Quantity,
    pub burned_supply: Quantity,
    pub max_issued_supply: Quantity,
    pub symbol: Option<AccountNumber>,
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

    use super::{Quantity, TokenRecord, TID};
    use crate::{services::tokens::Precision, AccountNumber, Memo};

    #[action]
    fn init() {
        unimplemented!()
    }

    /// Credit tokens to a debitor (recipient).
    ///
    /// On credit, tokens are typically automatically debited by the debitor. However,
    /// if the debitor has enabled `manual_debit`, then the tokens will be placed in an intermediate
    /// "shared balance".
    ///
    /// # Shared balance mechanics
    /// When in the shared balance, the tokens can be:
    /// * uncredited (transfer cancelled) by the creditor
    /// * debited (transfer accepted) by the debitor
    /// * rejected (transfer rejected) by the debitor
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier
    /// * `debitor`  - Debitor / recipient
    /// * `amount`   - Amount to credit
    /// * `memo`     - Memo
    #[action]
    fn credit(token_id: TID, debitor: AccountNumber, amount: Quantity, memo: Memo) {
        unimplemented!()
    }

    /// Uncredit tokens that were credited into a shared balance
    ///
    /// On credit, tokens are typically automatically debited by the debitor. However,
    /// if the debitor has enabled `manual_debit`, then the tokens will be placed in an intermediate
    /// "shared balance".
    ///
    /// # Shared balance mechanics
    /// When in the shared balance, the tokens can be:
    /// * uncredited (transfer cancelled) by the creditor
    /// * debited (transfer accepted) by the debitor
    /// * rejected (transfer rejected) by the debitor
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier
    /// * `debitor`  - Debitor / recipient
    /// * `amount`   - Amount to uncredit
    /// * `memo`     - Memo
    #[action]
    fn uncredit(token_id: TID, debitor: AccountNumber, amount: Quantity, memo: Memo) {
        unimplemented!()
    }

    /// Debit tokens that were credited into a shared balance
    ///
    /// On credit, tokens are typically automatically debited by the debitor. However,
    /// if the debitor has enabled `manual_debit`, then the tokens will be placed in an intermediate
    /// "shared balance".
    ///
    /// # Shared balance mechanics
    /// When in the shared balance, the tokens can be:
    /// * uncredited (transfer cancelled) by the creditor
    /// * debited (transfer accepted) by the debitor
    /// * rejected (transfer rejected) by the debitor
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier
    /// * `creditor` - User who credited the tokens
    /// * `amount`   - Amount to debit
    /// * `memo`     - Memo
    #[action]
    fn debit(token_id: TID, creditor: AccountNumber, amount: Quantity, memo: Memo) {
        unimplemented!()
    }

    /// Create a new token
    ///
    /// # Arguments
    /// * `precision` - Amount of decimal places in the token, 4 = 1.0000. 8 = 1.00000000
    /// * `max_issued_supply` - The permanent max issued supply of the token
    ///
    /// Returns the unique token identifier aka TID (u32)
    #[action]
    fn create(precision: Precision, max_issued_supply: Quantity) -> TID {
        unimplemented!()
    }

    /// Burn's the specified amount of the sender's specified tokens
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier
    /// * `amount`   - Amount of tokens to burn
    /// * `memo`     - Memo
    #[action]
    fn burn(token_id: TID, amount: Quantity, memo: Memo) {
        unimplemented!()
    }

    /// Mint / Issue new tokens into existence
    ///
    /// Only the token owner can mint new tokens, and only if the total issuance
    /// does not exceed the max issued supply.
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier
    /// * `amount`   - Amount of tokens to mint
    /// * `memo`     - Memo
    #[action]
    fn mint(token_id: TID, amount: Quantity, memo: Memo) {
        unimplemented!()
    }

    /// Recalls an amount of tokens from a user's balance and burns them
    ///
    /// Only the token owner can recall tokens, and only if the token is not marked as unrecallable.
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier
    /// * `from`     - User account from which to recall
    /// * `amount`   - Amount of tokens to recall
    /// * `memo`     - Memo
    #[action]
    fn recall(token_id: TID, from: AccountNumber, amount: Quantity, memo: Memo) {
        unimplemented!()
    }

    /// Lookup token details
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier
    ///
    /// Returns token information including current, burned supply and precision
    #[action]
    #[allow(non_snake_case)]
    fn getToken(token_id: TID) -> TokenRecord {
        unimplemented!()
    }

    /// Lookup token symbol
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier
    ///
    /// Returns token symbol
    #[action]
    #[allow(non_snake_case)]
    fn getTokenSym(token_id: TID) -> AccountNumber {
        unimplemented!()
    }

    /// Map a symbol to a token
    ///
    /// By default, tokens are only identifiable by their TID.
    /// Symbols may be mapped to improve usability. Once a symbol
    /// is mapped, it is permanent.
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier
    /// * `symbol` - Symbol e.g. "BTC"
    #[action]
    #[allow(non_snake_case)]
    fn mapSymbol(token_id: TID, symbol: AccountNumber) {
        unimplemented!()
    }

    /// Get user's global configuration.
    ///
    /// Settings apply to all tokens without a specific balance configuration.
    ///
    /// # Arguments
    /// * `account`  - User account
    /// * `index`    - Index of the configuration flag
    ///                Valid values: [0,8)
    ///                See `Configurations` for details
    ///
    /// Configurations:
    /// * 0: manual_debit       - If enabled, any credits of this token must be manually debited by
    ///                           the receiver.
    /// * 1: keep_zero_balances - If enabled, records with a balance of zero will still be kept in the
    ///                           balance table, and will not need to be recreated on the next deposit.
    ///
    /// Returns a `bool` indicating whether the specified configuration flag is enabled.
    #[action]
    fn getUserConf(account: AccountNumber, index: u8) -> bool {
        unimplemented!()
    }

    /// Set user global configuration of sender
    ///
    /// # Arguments
    /// * `index`    - Index of the configuration flag
    ///                Valid values: [0,8)
    ///                See `Configurations` for details
    /// * `enabled`  - A `bool` indicating the intended value of the specified configuration flag
    ///
    /// Configurations:
    /// * 0: manual_debit       - If enabled, any credits of this token must be manually debited by
    ///                           the receiver.
    /// * 1: keep_zero_balances - If enabled, records with a balance of zero will still be kept in the
    ///                           balance table, and will not need to be recreated on the next deposit.
    #[action]
    fn setUserConf(index: u8, enabled: bool) {
        unimplemented!()
    }

    /// Get user's token-specific balance configuration
    ///
    /// # Arguments
    /// * `account`  - User account
    /// * `token_id` - Unique token identifier
    /// * `index`    - Index of the configuration flag
    ///                Valid values: [0,8)
    ///                See `Configurations` for details
    ///
    /// Configurations:
    /// * 0: manual_debit       - If enabled, any credits of this token must be manually debited by
    ///                           the receiver.
    /// * 1: keep_zero_balances - If enabled, records with a balance of zero will still be kept in the
    ///                           balance table, and will not need to be recreated on the next deposit.
    ///
    /// Returns a `bool` indicating whether the specified configuration flag is enabled.
    #[action]
    fn getBalConf(account: AccountNumber, token_id: TID, index: u8) -> bool {
        unimplemented!()
    }

    /// Set user's token-specific balance configuration
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier
    /// * `index`    - Index of the configuration flag
    ///                Valid values: [0,8)
    ///                See `Configurations` for details
    /// * `enabled`  - A `bool` indicating the intended value of the specified configuration flag
    ///
    /// Configurations:
    /// * 0: manual_debit       - If enabled, any credits of this token must be manually debited by
    ///                           the receiver.
    /// * 1: keep_zero_balances - If enabled, records with a balance of zero will still be kept in the
    ///                           balance table, and will not need to be recreated on the next deposit.
    #[action]
    fn setBalConf(token_id: TID, index: u8, enabled: bool) {
        unimplemented!()
    }

    /// Delete the user's token-specific balance configuration
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier.
    #[action]
    fn delBalConf(token_id: TID) {
        unimplemented!()
    }

    /// Get token configuration
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier
    /// * `index`    - Index of the configuration flag
    ///                Valid values: [0,8)
    ///                See `Configurations` for details
    ///
    /// Configurations:
    /// * 0: Untransferrable - If enabled, the token cannot be transferred
    /// * 1: Unrecallable    - If enabled, the token cannot be recalled
    ///
    /// Returns a `bool` indicating whether the specified configuration flag is enabled
    #[action]
    fn getTokenConf(token_id: TID, index: u8) -> bool {
        unimplemented!()
    }

    /// Rejects the shared balance between a creditor and a debitor
    ///
    /// On credit, tokens are typically automatically debited by the debitor. However,
    /// if the debitor has enabled `manual_debit`, then the tokens will be placed in an intermediate
    /// "shared balance".
    ///
    /// # Shared balance mechanics
    /// When in the shared balance, the tokens can be:
    /// * uncredited (transfer cancelled) by the creditor
    /// * debited (transfer accepted) by the debitor
    /// * rejected (transfer rejected) by the debitor
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier
    /// * `creditor`  - User who credited the tokens
    /// * `memo`     - Memo
    #[action]
    fn reject(token_id: TID, creditor: AccountNumber, memo: Memo) {
        unimplemented!()
    }

    /// Set token configuration. Only the token owner can set the configuration.
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier
    /// * `index`    - Index of the configuration flag
    ///                Valid values: [0,8)
    ///                See `Configurations` for details
    /// * `enabled`  - A `bool` indicating whether the specified configuration flag is enabled.
    ///
    /// Configurations:
    /// * 0: Untransferrable - If enabled, the token cannot be transferred
    /// * 1: Unrecallable    - If enabled, the token cannot be recalled
    #[action]
    fn setTokenConf(token_id: TID, index: u8, enabled: bool) {
        unimplemented!()
    }

    /// Get user token balance
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier
    /// * `user` - User account
    ///
    /// Returns quantity of tokens in the user's balance
    #[action]
    fn getBalance(token_id: TID, user: AccountNumber) -> Quantity {
        unimplemented!()
    }

    /// Get shared balance between a creditor and debitor
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier
    /// * `creditor` - Creditor account
    /// * `debitor` - Debitor account
    ///
    /// Returns quantity of tokens in the shared balance
    #[action]
    fn getSharedBal(token_id: TID, creditor: AccountNumber, debitor: AccountNumber) -> Quantity {
        unimplemented!()
    }

    #[event(history)]
    pub fn configured(token_id: TID, action: String, memo: Memo) {}

    #[event(history)]
    pub fn supplyChanged(
        token_id: TID,
        counter_party: AccountNumber,
        action: String,
        amount: String,
        memo: Memo,
    ) {
    }

    #[event(history)]
    pub fn balChanged(
        token_id: TID,
        account: AccountNumber,
        counter_party: AccountNumber,
        action: String,
        amount: String,
        memo: Memo,
    ) {
    }
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
