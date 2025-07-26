pub mod decimal;
pub mod memo;
pub mod precision;
pub mod quantity;

pub use decimal::Decimal;
pub use memo::Memo;
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
    MemoTooLarge = "Memo must be 80 bytes or less"
}

pub type TID = u32;

pub const SYS_TOKEN: u32 = 1;
pub const UNTRANSFERABLE: u8 = 0;
pub const UNRECALLABLE: u8 = 1;
pub const MANUAL_DEBIT: u8 = 0;

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
    pub burned_supply: Quantity,
    pub max_issued_supply: Quantity,
    pub symbol: AccountNumber,
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

    use super::{Memo, Quantity, TokenRecord, TID};
    use crate::{services::tokens::Precision, AccountNumber};

    #[action]
    fn init() {
        unimplemented!()
    }

    /// Credit
    ///
    /// Send tokens to a shared balance between the creditor (sender) and the debitor (recipient)
    /// By default, funds will then move automatically from the shared balance to the debitor unless manual debiting is enabled by the `debitor`.
    /// `manual_debit` can be enabled using `setBalConf` or `setUserConf`
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier.
    /// * `debitor`  - Debitor / recipient of shared balance.
    /// * `amount`   - Amount to credit towards shared balance.
    /// * `memo`     - Memo
    #[action]
    fn credit(tokenId: TID, debitor: AccountNumber, amount: Quantity, memo: Memo) {
        unimplemented!()
    }

    /// Uncredit
    ///
    /// Refunds tokens from the shared balance between the creditor (sender) and the debitor, sending back to the creditor.
    ///
    /// This is mimics the behaviour as `reject` but is called by the `sender` instead of the `debitor`
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier.
    /// * `debitor`  - Debitor / recipient of shared balance.
    /// * `amount`   - Amount to uncredit from shared balance,
    /// * `memo`     - Memo
    #[action]
    fn uncredit(tokenId: TID, debitor: AccountNumber, maxAmount: Quantity, memo: Memo) {
        unimplemented!()
    }

    /// Debit
    ///
    /// Debits tokens from a shared balance between the creditor and the debitor (sender)
    ///
    /// By default, the debitor will automatically debit the amount towards the debitors balance.
    /// `manual_debit` can be enabled using `setBalConf` or `setUserConf`
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier.
    /// * `creditor` - User which previously sent balance towards debitor (sender).
    /// * `amount`   - Amount to debit / take from shared balance.
    /// * `memo`     - Memo
    #[action]
    fn debit(tokenId: TID, sender: AccountNumber, amount: Quantity, memo: Memo) {
        unimplemented!()
    }

    /// Create a new token.
    ///
    /// # Arguments
    /// * `precision` - Amount of decimal places in the token, 4 = 1.0000. 8 = 1.00000000
    /// * `max_issued_supply` - The permanent max issued supply of the token.
    ///
    /// # Returns the unique token identifier aka TID (u32)
    #[action]
    fn create(precision: Precision, max_issued_supply: Quantity) -> TID {
        unimplemented!()
    }

    /// Burn tokens.
    ///
    /// Burns the token balance of the sender and increases the burned supply by the specific amount.
    ///
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier.
    /// * `amount`   - Amount of tokens to burn.
    /// * `memo`     - Memo
    #[action]
    fn burn(tokenId: TID, amount: Quantity, memo: Memo) {
        unimplemented!()
    }

    /// Mint tokens.
    ///
    /// Mint / Issue new tokens into existence. Total issuance cannot exceed the max supply
    ///
    /// * Requires - Sender holds the Token owner NFT
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier.
    /// * `amount`   - Amount of tokens to burn.
    /// * `memo`     - Memo
    #[action]
    fn mint(tokenId: TID, amount: Quantity, memo: Memo) {
        unimplemented!()
    }

    /// Recall a user balance.
    ///
    /// Remote burns a specific user balance and increases burned supply by the specified amount.
    ///
    /// * Requires - Sender holds the Token owner NFT
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier.
    /// * `from`     - User balance to be burned
    /// * `amount`   - Amount of tokens to burn.
    /// * `memo`     - Memo
    #[action]
    fn recall(tokenId: TID, from: AccountNumber, amount: Quantity, memo: Memo) {
        unimplemented!()
    }

    /// Lookup token details.
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier.
    ///
    /// # Returns token information including current, burned supply and precision.
    #[action]
    #[allow(non_snake_case)]
    fn getToken(token_id: TID) -> TokenRecord {
        unimplemented!()
    }

    /// Lookup token symbol by token_id.
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier.
    ///
    /// # Returns token symbol.
    #[action]
    #[allow(non_snake_case)]
    fn getTokenSymbol(token_id: TID) -> AccountNumber {
        unimplemented!()
    }

    /// Map a symbol to a token.
    ///
    /// By default tokens are only identifiable by their TID, Symbols like "BTC" can be mapped as a permament one way lookup.
    /// Symbol mapping is permament and only map per token is allowed.
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier.
    /// * `symbol` - Symbol e.g. "BTC"
    #[action]
    #[allow(non_snake_case)]
    fn mapSymbol(token_id: TID, symbol: AccountNumber) {
        unimplemented!()
    }

    /// Get user global configuration.
    ///
    /// Settings apply to all tokens without a user balance configuration.
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier.
    /// * `index` - Position between 0 - 7
    ///
    /// # Returns a `bool` indicating whether the specified configuration flag is enabled.
    #[action]
    fn getUserConf(account: AccountNumber) -> bool {
        unimplemented!()
    }

    /// Set user global configuration of sender.
    ///
    /// # Arguments
    /// * `index` - Position between 0 - 7
    /// * `enabled` - A `bool` indicating whether the specified configuration flag is enabled.
    #[action]
    fn setUserConf(index: u8, enabled: bool) {
        unimplemented!()
    }

    /// Get user balance configuration.
    ///
    /// Settings apply only to specific token.
    ///
    /// # Arguments
    /// * `account` - User account.
    /// * `token_id` - Unique token identifier.
    /// * `index` - Position between 0 - 7
    ///
    ///
    /// # Returns a `bool` indicating whether the specified configuration flag is enabled.
    #[action]
    fn getBalConf(account: AccountNumber) -> bool {
        unimplemented!()
    }

    /// Set balance configuration
    ///
    /// Set user balance configuration of sender.
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier.
    /// * `index` - Position between 0 - 7
    /// * `enabled` - A `bool` indicating whether the specified configuration flag is enabled.
    #[action]
    fn setBalConf(token_id: TID, index: u8, enabled: bool) {
        unimplemented!()
    }

    /// Delete balance configuration
    ///
    /// Delete the balance configuration of sender.
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier.
    #[action]
    fn delBalConf(token_id: TID) {
        unimplemented!()
    }

    /// Get token configuration.
    ///
    /// Determine settings e.g. unrecallable and untransferable
    ///
    /// # Arguments
    /// * `account` - User account.
    /// * `token_id` - Unique token identifier.
    /// * `index` - Position between 0 - 7
    ///
    /// # Returns a `bool` indicating whether the specified configuration flag is enabled.
    #[action]
    fn getTokenConf(token_id: TID, index: u8) -> bool {
        unimplemented!()
    }

    /// Reject
    ///
    /// Returns the entire shared balance between the creditor and the debitor (sender), back to the creditor.
    ///
    /// This is mimics the behaviour as `uncredit` but is called by the `debitor` instead of the `creditor`
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier.
    /// * `creditor`  - Debitor / recipient of shared balance.
    /// * `memo`     - Memo
    #[action]
    fn reject(token_id: TID, creditor: AccountNumber, memo: Memo) {
        unimplemented!()
    }

    /// Set token configuration.
    ///
    /// * Requires - Sender holds the Token owner NFT
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier.
    /// * `index` - Position between 0 - 7
    /// * `enabled` - A `bool` indicating whether the specified configuration flag is enabled.
    #[action]
    fn setTokenConf(token_id: TID, index: u8, enabled: bool) {
        unimplemented!()
    }

    /// Get user balance.
    ///
    /// Fetch token specific balance of user account
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier.
    /// * `account` - User account.
    ///
    /// # Returns user balance
    #[action]
    fn getBalance(token_id: TID, user: AccountNumber) -> Quantity {
        unimplemented!()
    }

    /// Get shared balance.
    ///
    /// Fetch shared balance between the creditor and debitor.
    ///
    /// # Arguments
    /// * `creditor` - Creditor account.
    /// * `debitor` - Debitor account.
    /// * `token_id` - Unique token identifier.
    ///
    /// # Returns user balance
    #[action]
    fn getSharedBal(token_id: TID, creditor: AccountNumber, debitor: AccountNumber) -> Quantity {
        unimplemented!()
    }
}
