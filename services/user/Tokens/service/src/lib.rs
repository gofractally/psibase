pub mod tables;

#[psibase::service(tables = "tables::tables")]
pub mod service {
    use crate::tables::tables::*;
    pub use crate::tables::tables::{BalanceFlags, TokenFlags};
    use psibase::services::nft::{Wrapper as Nfts, NID};
    use psibase::services::symbol::{Service::Wrapper as Symbol, SID};
    use psibase::services::tokens::{Memo, Precision, Quantity};
    use psibase::AccountNumber;

    use psibase::{Fracpack, ToSchema};
    use serde::{Deserialize, Serialize};

    use psibase::*;

    pub type TID = u32;

    #[derive(Fracpack, ToSchema, Serialize, Deserialize, Debug, Clone)]
    pub struct TokenRecord {
        pub id: TID,
        pub nft_id: NID,
        pub settings_value: u8,
        pub precision: Precision,
        pub current_supply: Quantity,
        pub burned_supply: Quantity,
        pub max_supply: Quantity,
        pub symbol: SID,
    }

    impl From<Token> for TokenRecord {
        fn from(token: Token) -> Self {
            Self {
                id: token.id,
                nft_id: token.nft_id,
                settings_value: token.settings_value,
                precision: token.precision.try_into().unwrap(),
                current_supply: token.issued_supply - token.burned_supply,
                burned_supply: token.burned_supply,
                max_supply: token.max_supply,
                symbol: token.symbol.unwrap_or(AccountNumber::from(0)),
            }
        }
    }

    #[action]
    fn init() {
        let table = InitTable::new();

        if table.get_index_pk().get(&()).is_none() {
            let init_instance = InitRow { last_used_id: 0 };
            table.put(&init_instance).unwrap();

            Nfts::call_from(Wrapper::SERVICE)
                .setUserConf(psibase::NamedBit::from("manualDebit"), true)
        }
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::new();
        check_some(table.get_index_pk().get(&()), "service not initiated");
    }

    #[action]
    fn create(max_supply: Quantity, precision: u8) -> TID {
        check(max_supply.value > 0, "max supply must be greator than 0");
        let new_token = Token::add(max_supply, precision);

        Wrapper::emit()
            .history()
            .created(new_token.id, get_sender(), precision, max_supply);

        new_token.id
    }

    #[action]
    #[allow(non_snake_case)]
    fn getToken(token_id: TID) -> TokenRecord {
        Token::get_assert(token_id).into()
    }

    #[action]
    fn map_symbol(token_id: TID, symbol: AccountNumber) {
        let mut token = Token::get_assert(token_id);

        token.map_symbol(symbol);

        let symbol_owner_nft = Symbol::call_from(Wrapper::SERVICE)
            .getSymbol(symbol)
            .ownerNft;

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

    #[action]
    #[allow(non_snake_case)]
    fn getBalConf(account: AccountNumber, token_id: TID, index: u8) -> bool {
        BalanceConfig::get_or_new(account, token_id).get_flag(index.into())
    }

    #[action]
    #[allow(non_snake_case)]
    fn setBalConf(token_id: TID, index: u8, enabled: bool) {
        BalanceConfig::get_or_new(get_sender(), token_id).set_flag(index.into(), enabled);
    }

    #[action]
    #[allow(non_snake_case)]
    fn getUserConf(account: AccountNumber, index: u8) -> bool {
        UserConfig::get_or_new(account).get_flag(index.into())
    }

    #[action]
    #[allow(non_snake_case)]
    fn setUserConf(index: u8, enabled: bool) {
        UserConfig::get_or_new(get_sender()).set_flag(index.into(), enabled);
    }

    #[action]
    #[allow(non_snake_case)]
    fn getTokenConf(token_id: TID, index: u8) -> bool {
        Token::get_assert(token_id).get_flag(index.into())
    }

    #[action]
    #[allow(non_snake_case)]
    fn setTokenConf(token_id: TID, index: u8, enabled: bool) {
        Token::get_assert(token_id).set_flag(index.into(), enabled);
    }

    #[action]
    #[allow(non_snake_case)]
    fn getBalance(token_id: TID, user: AccountNumber) -> Balance {
        Balance::get_or_new(user, token_id)
    }

    #[action]
    #[allow(non_snake_case)]
    fn getSharedBal(
        creditor: AccountNumber,
        debitor: AccountNumber,
        token_id: TID,
    ) -> SharedBalance {
        SharedBalance::get_or_new(creditor, debitor, token_id)
    }

    #[action]
    fn recall(token_id: TID, from: AccountNumber, amount: Quantity, memo: Memo) {
        memo.validate();
        Token::get_assert(token_id).recall(amount, from);

        Wrapper::emit()
            .history()
            .recalled(token_id, amount, get_sender(), from, memo);
    }

    #[action]
    fn burn(token_id: TID, amount: Quantity, memo: Memo) {
        memo.validate();
        Token::get_assert(token_id).burn(amount);

        Wrapper::emit()
            .history()
            .burned(token_id, get_sender(), amount, memo);
    }

    #[action]
    fn mint(token_id: TID, amount: Quantity, memo: Memo) {
        memo.validate();
        Token::get_assert(token_id).mint(amount);

        Wrapper::emit().history().minted(token_id, amount, memo);
    }

    #[action]
    fn credit(token_id: TID, debitor: AccountNumber, amount: Quantity, memo: Memo) {
        memo.validate();
        let creditor = get_sender();
        SharedBalance::get_or_new(creditor, debitor, token_id).credit(amount);

        Wrapper::emit()
            .history()
            .credited(token_id, creditor, debitor, amount, memo);
    }

    #[action]
    fn uncredit(token_id: TID, debitor: AccountNumber, amount: Quantity, memo: Memo) {
        memo.validate();
        let creditor = get_sender();

        SharedBalance::get_assert(creditor, debitor, token_id).uncredit(amount);

        Wrapper::emit()
            .history()
            .uncredited(token_id, creditor, debitor, amount, memo);
    }

    #[action]
    fn debit(token_id: TID, creditor: AccountNumber, amount: Quantity, memo: Memo) {
        memo.validate();
        SharedBalance::get_assert(creditor, get_sender(), token_id).debit(amount, memo);
    }

    #[action]
    fn reject(token_id: TID, creditor: AccountNumber, memo: Memo) {
        memo.validate();
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
    pub fn created(token_id: TID, sender: AccountNumber, precision: u8, max_supply: Quantity) {}

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
