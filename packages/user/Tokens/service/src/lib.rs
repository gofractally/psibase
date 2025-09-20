pub mod helpers;
pub mod tables;

#[psibase::service(tables = "tables::tables")]
pub mod service {
    use crate::tables::tables::*;
    pub use crate::tables::tables::{BalanceFlags, TokenFlags};
    use psibase::services::nft::Wrapper as Nfts;
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
        let table = InitTable::new();
        check_some(table.get_index_pk().get(&()), "service not initiated");
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

    /// Lookup token details.
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier.
    ///
    /// # Returns token information including current, burned supply and precision.
    #[action]
    #[allow(non_snake_case)]
    fn getToken(token_id: TID) -> Token {
        Token::get_assert(token_id)
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
    #[allow(non_snake_case)]
    fn getBalConf(account: AccountNumber, token_id: TID, index: u8) -> bool {
        BalanceConfig::get_or_new(account, token_id).get_flag(index.into())
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
    #[allow(non_snake_case)]
    fn setBalConf(token_id: TID, index: u8, enabled: bool) {
        BalanceConfig::get_or_new(get_sender(), token_id).set_flag(index.into(), enabled);
    }

    /// Delete balance configuration
    ///
    /// Delete the balance configuration of sender.
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier.
    #[action]
    #[allow(non_snake_case)]
    fn delBalConf(token_id: TID) {
        BalanceConfig::get_assert(get_sender(), token_id).delete();
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
    #[allow(non_snake_case)]
    fn getUserConf(account: AccountNumber, index: u8) -> bool {
        UserConfig::get_or_new(account).get_flag(index.into())
    }

    /// Set user global configuration of sender.
    ///
    /// # Arguments
    /// * `index` - Position between 0 - 7
    /// * `enabled` - A `bool` indicating whether the specified configuration flag is enabled.
    #[action]
    #[allow(non_snake_case)]
    fn setUserConf(index: u8, enabled: bool) {
        UserConfig::get_or_new(get_sender()).set_flag(index.into(), enabled);
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
    #[allow(non_snake_case)]
    fn getTokenConf(token_id: TID, index: u8) -> bool {
        Token::get_assert(token_id).get_flag(index.into())
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
    #[allow(non_snake_case)]
    fn setTokenConf(token_id: TID, index: u8, enabled: bool) {
        Token::get_assert(token_id).set_flag(index.into(), enabled);
    }

    /// Get user balance.
    ///
    /// Fetch token specific balance of user account
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier.
    /// * `account` - User account.
    ///
    /// # Returns user balance information
    #[action]
    #[allow(non_snake_case)]
    fn getBalance(token_id: TID, user: AccountNumber) -> Quantity {
        Balance::get_or_new(user, token_id).balance
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
    #[allow(non_snake_case)]
    fn getSharedBal(token_id: TID, creditor: AccountNumber, debitor: AccountNumber) -> Quantity {
        SharedBalance::get_or_new(creditor, debitor, token_id).balance
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
    fn recall(token_id: TID, from: AccountNumber, amount: Quantity, memo: Memo) {
        Token::get_assert(token_id).recall(amount, from);

        Wrapper::emit()
            .history()
            .recalled(token_id, amount, get_sender(), from, memo);
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
    fn burn(token_id: TID, amount: Quantity, memo: Memo) {
        Token::get_assert(token_id).burn(amount);

        Wrapper::emit()
            .history()
            .burned(token_id, get_sender(), amount, memo);
    }

    /// Mint tokens.
    ///
    /// Mint / Issue new tokens into existence. Total issuance cannot exceed the max issued supply
    ///
    /// * Requires - Sender holds the Token owner NFT
    ///
    /// # Arguments
    /// * `token_id` - Unique token identifier.
    /// * `amount`   - Amount of tokens to burn.
    /// * `memo`     - Memo
    #[action]
    fn mint(token_id: TID, amount: Quantity, memo: Memo) {
        Token::get_assert(token_id).mint(amount);

        Wrapper::emit().history().minted(token_id, amount, memo);
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
    fn credit(token_id: TID, debitor: AccountNumber, amount: Quantity, memo: Memo) {
        let creditor = get_sender();
        SharedBalance::get_or_new(creditor, debitor, token_id).credit(amount);

        Wrapper::emit()
            .history()
            .credited(token_id, creditor, debitor, amount, memo);
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
    fn uncredit(token_id: TID, debitor: AccountNumber, amount: Quantity, memo: Memo) {
        let creditor = get_sender();

        SharedBalance::get_assert(creditor, debitor, token_id).uncredit(amount);

        Wrapper::emit()
            .history()
            .uncredited(token_id, creditor, debitor, amount, memo);
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
    fn debit(token_id: TID, creditor: AccountNumber, amount: Quantity, memo: Memo) {
        SharedBalance::get_assert(creditor, get_sender(), token_id).debit(amount, memo);
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
