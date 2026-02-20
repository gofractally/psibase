#![allow(non_snake_case)]

pub mod helpers;
pub mod tables;
pub use tables::tables::{BalanceFlags, TokenFlags};

#[psibase::service(tables = "tables::tables")]
pub mod service {
    pub use crate::tables::tables::{BalanceFlags, TokenFlags};
    use crate::tables::tables::{ConfigRow, SubAccount, *};
    use psibase::services::events;
    use psibase::services::nft::{NftHolderFlags, Wrapper as Nfts};
    use psibase::services::tokens::{Decimal, Precision, Quantity};
    use psibase::{get_sender, AccountNumber, Memo};

    use psibase::*;

    pub type TID = u32;

    pub fn fmt_amount(token_id: TID, amount: Quantity) -> String {
        Decimal::new(amount, Token::get_assert(token_id).precision).to_string()
    }

    #[action]
    fn init() {
        if InitRow::get().is_none() {
            InitRow::init();

            Nfts::call().setUserConf(NftHolderFlags::MANUAL_DEBIT.index(), true);

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
        check_some(table.get_index_pk().get(&()), "service not initialized");
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
    fn getToken(token_id: TID) -> Token {
        Token::get_assert(token_id)
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
    fn setBalConf(token_id: TID, index: u8, enabled: bool) {
        BalanceConfig::get_or_new(get_sender(), token_id).set_flag(index.into(), enabled);
    }

    /// Delete the user's token-specific balance configuration
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier.
    #[action]
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
        SharedBalance::get_or_new(creditor, get_sender(), token_id).reject(memo);
    }

    /// Sends tokens from an account's primary balance into a "sub-account" balance
    ///
    /// The sub-account will be created if it does not exist.
    ///
    /// If a sub-account is created in this way, it will be deleted automatically when
    /// it has no token balances. To persist the sub-account until manually deleted, use
    /// `createSub`.
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier
    /// * `sub_account` - Sub-account key
    /// * `amount`   - Amount of tokens to send
    #[action]
    fn toSub(token_id: TID, sub_account: String, amount: Quantity) {
        let owner = get_sender();
        SubAccount::get_or_add(owner, sub_account.clone(), !SubAccount::MANUAL_DEL)
            .add_balance(token_id, amount);

        Wrapper::emit().history().balChanged(
            token_id,
            owner,
            owner,
            "toSub".to_string(),
            fmt_amount(token_id, amount),
            Memo::new(sub_account).unwrap(),
        );
    }

    /// Returns tokens from a "sub-account" balance into the account's primary balance
    ///
    /// If the subaccount was created using `toSub`, then it will be automatically deleted if this action
    /// results in the sub-account having no token balances.
    ///
    /// If the subaccount was created manually, then it must be deleted manually using `deleteSub`.
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier
    /// * `sub_account` - Sub-account key
    /// * `amount`   - Amount of tokens to return
    #[action]
    fn fromSub(token_id: TID, sub_account: String, amount: Quantity) {
        let owner = get_sender();

        SubAccount::get_assert(owner, sub_account.clone()).sub_balance(token_id, amount);

        Wrapper::emit().history().balChanged(
            token_id,
            owner,
            owner,
            "fromSub".to_string(),
            fmt_amount(token_id, amount),
            Memo::new(sub_account).unwrap(),
        );
    }

    /// Creates a new "sub-account" with an empty balance
    ///
    /// A sub-account created manually in this way must be deleted manually using
    /// `deleteSub`.
    ///
    /// This action will fail if the sub-account was already manually created. This action
    /// will succeed if the sub-account was created automatically using `toSub`, in which
    /// case the sub-account is updated to require manual deletion using `deleteSub`.
    ///
    /// # Arguments
    /// * `sub_account` - Sub-account key
    #[action]
    fn createSub(sub_account: String) {
        SubAccount::get_or_add(get_sender(), sub_account, SubAccount::MANUAL_DEL);
    }

    /// Deletes a "sub-account"
    ///
    /// This action will fail if any sub-account balances are non-zero.
    ///
    /// # Arguments
    /// * `sub_account` - Sub-account key
    #[action]
    fn deleteSub(sub_account: String) {
        SubAccount::get_assert(get_sender(), sub_account).delete();
    }

    /// Sets the system token
    ///
    /// # Arguments
    /// * `token_id` - Identifier of a previously created token
    ///
    /// # Notes
    /// * Only the service account can set the system token
    /// * The system token can only be set once (changing system token is not yet supported)
    #[action]
    fn setSysToken(tokenId: TID) {
        check(get_sender() == get_service(), "Unauthorized");
        check(Token::get(tokenId).is_some(), "Token DNE");

        let config_table = ConfigTable::new();
        check(
            config_table.get_index_pk().get(&()).is_none(),
            "Changing system token is not supported",
        );
        config_table.put(&ConfigRow { sys_tid: tokenId }).unwrap();
    }

    /// Gets the system token details (if set), otherwise returns `None`
    #[action]
    fn getSysToken() -> Option<Token> {
        ConfigTable::read()
            .get_index_pk()
            .get(&())
            .map(|row| Token::get_assert(row.sys_tid))
    }

    /// Get the token balance of the sender's specified sub-account
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier
    /// * `sub_account` - Sub-account key
    ///
    /// Returns the token balance of the sender's specified sub-account
    /// or `None` if the sub-account does not exist
    #[action]
    fn getSubBal(token_id: TID, sub_account: String) -> Option<Quantity> {
        SubAccount::get(get_sender(), sub_account).map(|sa| sa.get_balance(token_id))
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
