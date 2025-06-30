pub mod flags;
pub mod tables;

#[psibase::service(tables = "tables::tables")]
pub mod service {

    use crate::tables::tables::{
        Balance, Holder, InitRow, InitTable, SharedBalance, Token, TokenHolder,
    };
    use psibase::services::nft::{Wrapper as Nfts, NID};
    use psibase::services::symbol::{Service::Wrapper as Symbol, SID};
    use psibase::{AccountNumber, Precision, Quantity};

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
                current_supply: token.current_supply,
                max_supply: token.max_supply,
                symbol: token.symbol.unwrap_or(AccountNumber::from(0)),
            }
        }
    }

    #[action]
    fn init() {
        let table = InitTable::new();

        let init_instance = InitRow { last_used_id: 0 };
        table.put(&init_instance).unwrap();

        Nfts::call_from(Wrapper::SERVICE).setUserConf(psibase::NamedBit::from("manualDebit"), true)
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
    fn get_token_by_symbol(symbol: AccountNumber) -> Option<TokenRecord> {
        Token::get_by_symbol(symbol).map(|token| token.into())
    }

    #[action]
    fn map_symbol(token_id: TID, symbol: AccountNumber) {
        let mut token = Token::get_assert(token_id);
        let sender = get_sender();
        token.check_is_owner(sender);
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
            .symbol_mapped(token_id, sender, symbol);
    }

    #[action]
    #[allow(non_snake_case)]
    fn getUserConf(account: AccountNumber) -> Holder {
        Holder::get_or_new(account)
    }

    #[action]
    #[allow(non_snake_case)]
    fn setUserConf(index: u8, enabled: bool) {
        Holder::get_or_new(get_sender()).set_settings(index, enabled);
    }

    #[action]
    #[allow(non_snake_case)]
    fn getTokHoldr(account: AccountNumber, token_id: TID) -> TokenHolder {
        TokenHolder::get_or_new(account, token_id)
    }

    #[action]
    #[allow(non_snake_case)]
    fn setTokHoldr(token_id: TID, index: u8, enabled: bool) {
        TokenHolder::get_or_new(get_sender(), token_id).set_settings(index, enabled);
    }

    #[action]
    #[allow(non_snake_case)]
    fn setTokenConf(token_id: TID, index: u8, enabled: bool) {
        let mut token = Token::get_assert(token_id);
        token.check_is_owner(get_sender());
        token.set_settings(index, enabled);
    }

    #[action]
    fn open(token_id: TID) {
        Balance::add(get_sender(), token_id);
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
    fn recall(token_id: TID, from: AccountNumber, amount: Quantity, memo: String) {
        check(amount.value > 0, "must be greater than 0");
        let sender = get_sender();
        let mut token = Token::get_assert(token_id);
        let token_settings = token.settings();

        check(sender != from, "cannot recall from self, use burn instead");
        check(!token_settings.is_unrecallable(), "token is not recallable");

        token.check_is_owner(sender);
        token.burn(amount, from);

        Wrapper::emit()
            .history()
            .recall(token_id, amount, sender, from, memo);
    }

    #[action]
    fn burn(token_id: TID, amount: Quantity, memo: String) {
        let sender = get_sender();
        let mut token = Token::get_assert(token_id);
        let token_settings = token.settings();

        check(!token_settings.is_unburnable(), "token is not burnable");

        token.burn(amount, sender);

        Wrapper::emit()
            .history()
            .burn(token_id, sender, amount, memo);
    }

    #[action]
    fn mint(token_id: TID, amount: Quantity, memo: String) {
        let mut token = Token::get_assert(token_id);
        let sender = get_sender();
        token.check_is_owner(sender);
        token.mint(amount, sender);

        Wrapper::emit().history().minted(token_id, amount, memo);
    }

    #[action]
    fn credit(token_id: TID, debitor: AccountNumber, amount: Quantity, memo: String) {
        let creditor = get_sender();
        SharedBalance::get_or_new(creditor, debitor, token_id).credit(amount);

        Wrapper::emit()
            .history()
            .credited(token_id, creditor, debitor, amount, memo);
    }

    #[action]
    fn uncredit(token_id: TID, debitor: AccountNumber, amount: Quantity, memo: String) {
        let creditor = get_sender();

        SharedBalance::get_or_new(creditor, debitor, token_id).uncredit(amount);

        Wrapper::emit()
            .history()
            .uncredited(token_id, creditor, debitor, amount, memo);
    }

    #[action]
    fn debit(token_id: TID, creditor: AccountNumber, amount: Quantity, memo: String) {
        SharedBalance::get_or_new(creditor, get_sender(), token_id).debit(amount, memo);
    }

    #[event(history)]
    pub fn recall(
        token_id: TID,
        amount: Quantity,
        sender: AccountNumber,
        burnee: AccountNumber,
        memo: String,
    ) {
    }

    #[event(history)]
    pub fn burn(token_id: TID, sender: AccountNumber, amount: Quantity, memo: String) {}

    #[event(history)]
    pub fn created(token_id: TID, sender: AccountNumber, precision: u8, max_supply: Quantity) {}

    #[event(history)]
    pub fn minted(token_id: TID, amount: Quantity, memo: String) {}

    #[event(history)]
    pub fn symbol_mapped(token_id: TID, sender: AccountNumber, symbol: AccountNumber) {}

    #[event(history)]
    pub fn credited(
        token_id: TID,
        creditor: AccountNumber,
        debitor: AccountNumber,
        amount: Quantity,
        memo: String,
    ) {
    }

    #[event(history)]
    pub fn uncredited(
        token_id: TID,
        creditor: AccountNumber,
        debitor: AccountNumber,
        amount: Quantity,
        memo: String,
    ) {
    }

    #[event(history)]
    pub fn debited(
        token_id: TID,
        creditor: AccountNumber,
        debitor: AccountNumber,
        amount: Quantity,
        memo: String,
    ) {
    }
}

#[cfg(test)]
mod tests;
