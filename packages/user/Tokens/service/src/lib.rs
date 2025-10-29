pub mod helpers;
pub mod tables;
pub use tables::tables::{BalanceFlags, TokenFlags};

#[psibase::service(tables = "tables::tables")]
pub mod service {
    use crate::tables::tables::*;
    pub use crate::tables::tables::{BalanceFlags, TokenFlags};
    use psibase::services::events;
    use psibase::services::nft::Wrapper as Nfts;
    use psibase::services::symbol::Service::Wrapper as Symbol;
    use psibase::services::tokens::{Decimal, Precision, Quantity};
    use psibase::{get_sender, AccountNumber, Memo};

    use psibase::*;

    pub type TID = u32;

    pub fn fmt_amount(token_id: TID, amount: Quantity) -> String {
        Decimal::new(amount, Token::get_assert(token_id).precision).to_string()
    }

    #[action]
    fn init() {
        let table = InitTable::new();

        if table.get_index_pk().get(&()).is_none() {
            let init_instance = InitRow { last_used_id: 0 };
            table.put(&init_instance).unwrap();

            Nfts::call().setUserConf(psibase::NamedBit::from("manualDebit"), true);

            let add_index = |method: &str, column: u8| {
                events::Wrapper::call().addIndex(
                    DbId::HistoryEvent,
                    Wrapper::SERVICE,
                    MethodNumber::from(method),
                    column,
                );
            };

            add_index("configured", 0);
            add_index("supplyChanged", 0);
            add_index("balChanged", 1);
            add_index("balChanged", 2);

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

        let tid = new_token.id;
        Wrapper::emit().history().configured(
            tid,
            "created".to_string(),
            Memo::new(format!(
                "New token {} with max supply: {}",
                tid,
                fmt_amount(tid, max_issued_supply)
            ))
            .unwrap(),
        );

        tid
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
    fn mapSymbol(token_id: TID, symbol: AccountNumber) {}

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
        let flag = index.into();
        Token::get_assert(token_id).set_flag(flag, enabled);

        Wrapper::emit().history().configured(
            token_id,
            "configured".to_string(),
            format!("Flag: {}: {}", flag.to_string(), enabled)
                .try_into()
                .unwrap(),
        );
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
        let mut token = Token::get_assert(token_id);

        token.recall(amount, from);

        let actor = get_sender();
        let recalled = "recalled".to_string();
        let amount = fmt_amount(token_id, amount);
        let event = Wrapper::emit().history();

        event.balChanged(
            token_id,
            from,  // We want this balance change event to show in `from`'s balChanged index
            actor, // In this exceptional case, the actor is the counterparty
            recalled.clone(),
            amount.clone(),
            memo.clone(),
        );

        event.supplyChanged(
            token_id,
            actor,
            recalled,
            amount,
            Memo::new(format!("Recalled from {}", from)).unwrap(),
        );
    }

    /// Burn's the specified amount of the sender's specified tokens
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier
    /// * `amount`   - Amount of tokens to burn
    /// * `memo`     - Memo
    #[action]
    fn burn(token_id: TID, amount: Quantity, memo: Memo) {
        let mut token = Token::get_assert(token_id);

        token.burn(amount);

        let actor = get_sender();
        let burned = "burned".to_string();
        let amount = fmt_amount(token_id, amount);
        let event = Wrapper::emit().history();

        event.balChanged(
            token_id,
            actor,
            actor,
            burned.clone(),
            amount.clone(),
            memo.clone(),
        );

        event.supplyChanged(token_id, actor, burned, amount, memo);
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
        let mut token = Token::get_assert(token_id);

        token.mint(amount);

        Wrapper::emit().history().supplyChanged(
            token_id,
            get_sender(),
            "minted".to_string(),
            fmt_amount(token_id, amount),
            memo,
        );
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
        SharedBalance::get_or_new(creditor, debitor, token_id).credit(amount, memo.clone());

        Wrapper::emit().history().balChanged(
            token_id,
            creditor,
            debitor,
            "credited".to_string(),
            fmt_amount(token_id, amount),
            memo,
        );
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

        Wrapper::emit().history().balChanged(
            token_id,
            creditor,
            debitor,
            "uncredited".to_string(),
            fmt_amount(token_id, amount),
            memo,
        );
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
    pub fn configured(token_id: TID, action: String, memo: Memo) {}

    #[event(history)]
    pub fn supplyChanged(
        token_id: TID,
        actor: AccountNumber,
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

#[cfg(test)]
mod tests;
