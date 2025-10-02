pub mod helpers;
pub mod tables;

#[psibase::service(tables = "tables::tables")]
pub mod service {
    use crate::tables::tables::*;
    pub use crate::tables::tables::{BalanceFlags, TokenFlags};
    use psibase::services::nft::Wrapper as Nfts;
    use psibase::services::symbol::Service::Wrapper as Symbol;
    use psibase::services::tokens::{Precision, Quantity};
    use psibase::{AccountNumber, Memo};

    use psibase::*;

    pub type TID = u32;

    #[action]
    fn init() {
        let table = InitTable::new();

        if table.get_index_pk().get(&()).is_none() {
            let init_instance = InitRow { last_used_id: 0 };
            table.put(&init_instance).unwrap();

            Nfts::call_from(Wrapper::SERVICE)
                .setUserConf(psibase::NamedBit::from("manualDebit"), true);
            UserConfig::get_or_new(Wrapper::SERVICE).set_flag(BalanceFlags::MANUAL_DEBIT, true);
        }
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::read();
        check_some(table.get_index_pk().get(&()), "service not initiated");
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
        check(
            max_issued_supply.value > 0,
            "Max issued supply must be greater than 0",
        );
        let new_token = Token::add(precision, max_issued_supply);

        Wrapper::emit()
            .history()
            .created(new_token.id, get_sender(), precision, max_issued_supply);

        new_token.id
    }

    /// Lookup token details
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier
    ///
    /// Returns token information including current, burned supply and precision
    #[action]
    #[allow(non_snake_case)]
    fn getToken(token_id: TID) -> Token {
        Token::get_assert(token_id)
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
        check_some(
            Token::get_assert(token_id).symbol,
            "token does not have symbol",
        )
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
        let mut token = Token::get_assert(token_id);

        token.map_symbol(symbol);

        let symbol_owner_nft = Symbol::call_from(Wrapper::SERVICE)
            .getSymbol(symbol)
            .ownerNft;
        check(symbol_owner_nft != 0, "Symbol does not exist");

        Nfts::call_from(Wrapper::SERVICE).debit(
            symbol_owner_nft,
            format!(
                "Mapping symbol {} to token {}",
                symbol.to_string(),
                token_id
            ),
        );
        Nfts::call_from(Wrapper::SERVICE).burn(symbol_owner_nft);

        Wrapper::emit()
            .history()
            .symbol_mapped(token_id, get_sender(), symbol);
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
    #[allow(non_snake_case)]
    fn getBalConf(account: AccountNumber, token_id: TID, index: u8) -> bool {
        BalanceConfig::get_or_new(account, token_id).get_flag(index.into())
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
    #[allow(non_snake_case)]
    fn setBalConf(token_id: TID, index: u8, enabled: bool) {
        BalanceConfig::get_or_new(get_sender(), token_id).set_flag(index.into(), enabled);
    }

    /// Delete the user's token-specific balance configuration
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier.
    #[action]
    #[allow(non_snake_case)]
    fn delBalConf(token_id: TID) {
        BalanceConfig::get_assert(get_sender(), token_id).delete();
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
    #[allow(non_snake_case)]
    fn getUserConf(account: AccountNumber, index: u8) -> bool {
        UserConfig::get_or_new(account).get_flag(index.into())
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
    #[allow(non_snake_case)]
    fn setUserConf(index: u8, enabled: bool) {
        UserConfig::get_or_new(get_sender()).set_flag(index.into(), enabled);
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
    #[allow(non_snake_case)]
    fn getTokenConf(token_id: TID, index: u8) -> bool {
        Token::get_assert(token_id).get_flag(index.into())
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
    #[allow(non_snake_case)]
    fn setTokenConf(token_id: TID, index: u8, enabled: bool) {
        Token::get_assert(token_id).set_flag(index.into(), enabled);
    }

    /// Get user token balance
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier
    /// * `user` - User account
    ///
    /// Returns quantity of tokens in the user's balance
    #[action]
    #[allow(non_snake_case)]
    fn getBalance(token_id: TID, user: AccountNumber) -> Quantity {
        Balance::get_or_new(user, token_id).balance
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
    #[allow(non_snake_case)]
    fn getSharedBal(token_id: TID, creditor: AccountNumber, debitor: AccountNumber) -> Quantity {
        SharedBalance::get_or_new(creditor, debitor, token_id).balance
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
        Token::get_assert(token_id).recall(amount, from);

        Wrapper::emit()
            .history()
            .recalled(token_id, amount, get_sender(), from, memo);
    }

    /// Burn's the specified amount of the sender's specified tokens
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier
    /// * `amount`   - Amount of tokens to burn
    /// * `memo`     - Memo
    #[action]
    fn burn(token_id: TID, amount: Quantity, memo: Memo) {
        Token::get_assert(token_id).burn(amount);

        Wrapper::emit()
            .history()
            .burned(token_id, get_sender(), amount, memo);
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
        Token::get_assert(token_id).mint(amount);

        Wrapper::emit().history().minted(token_id, amount, memo);
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
        let creditor = get_sender();
        SharedBalance::get_or_new(creditor, debitor, token_id).credit(amount);

        Wrapper::emit()
            .history()
            .credited(token_id, creditor, debitor, amount, memo);
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
        let creditor = get_sender();

        SharedBalance::get_assert(creditor, debitor, token_id).uncredit(amount);

        Wrapper::emit()
            .history()
            .uncredited(token_id, creditor, debitor, amount, memo);
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
        SharedBalance::get_assert(creditor, get_sender(), token_id).debit(amount, memo);
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
        SharedBalance::get_assert(creditor, get_sender(), token_id).reject(memo);
    }

    #[event(history)]
    pub fn recalled(
        token_id: TID,
        amount: Quantity,
        burner: AccountNumber,
        from: AccountNumber,
        memo: Memo,
    ) {
    }

    #[event(history)]
    pub fn burned(token_id: TID, sender: AccountNumber, amount: Quantity, memo: Memo) {}

    #[event(history)]
    pub fn created(
        token_id: TID,
        sender: AccountNumber,
        precision: Precision,
        max_issued_supply: Quantity,
    ) {
    }

    #[event(history)]
    pub fn minted(token_id: TID, amount: Quantity, memo: Memo) {}

    #[event(history)]
    pub fn symbol_mapped(token_id: TID, sender: AccountNumber, symbol: AccountNumber) {}

    #[event(history)]
    pub fn credited(
        token_id: TID,
        creditor: AccountNumber,
        debitor: AccountNumber,
        amount: Quantity,
        memo: Memo,
    ) {
    }

    #[event(history)]
    pub fn uncredited(
        token_id: TID,
        creditor: AccountNumber,
        debitor: AccountNumber,
        amount: Quantity,
        memo: Memo,
    ) {
    }

    #[event(history)]
    pub fn debited(
        token_id: TID,
        creditor: AccountNumber,
        debitor: AccountNumber,
        amount: Quantity,
        memo: Memo,
    ) {
    }

    #[event(history)]
    pub fn rejected(token_id: TID, creditor: AccountNumber, debitor: AccountNumber, memo: Memo) {}
}

#[cfg(test)]
mod tests;
