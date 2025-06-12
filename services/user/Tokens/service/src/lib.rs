pub mod flags;
pub mod tables;

#[psibase::service(tables = "tables::tables")]
pub mod service {
    use crate::tables::tables::{
        Balance, Holder, InitRow, InitTable, SharedBalance, Token, TokenHolder,
    };
    use psibase::services::nft::Wrapper as Nfts;
    use psibase::services::symbol::Service::Wrapper as Symbol;
    use psibase::services::tokens::Actions as Tokens;

    use psibase::{Quantity, *};

    #[action]
    fn init() {
        // check_none(Token::get(1), "init already ran");
        if Token::get(1).is_some() {
            return;
        }
        let table = InitTable::new();
        let init_instance = InitRow { last_used_id: 0 };
        table.put(&init_instance).unwrap();

        let precision: u8 = 4;

        let native_token = Token::add(
            Quantity::from_str("1000000", precision.into()).unwrap(),
            precision,
        );

        check(native_token.id == 1, "expected native token to be ID of 1");
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::new();
        check(
            table.get_index_pk().get(&()).is_some(),
            "service not initiated",
        );
    }

    #[action]
    fn create(max_supply: Quantity, precision: u8) -> u32 {
        check(max_supply.value > 0, "max supply must be greator than 0");
        let new_token = Token::add(max_supply, precision);

        let creator = get_sender();

        if creator != get_service() {
            Nfts::call().credit(
                new_token.nft_id,
                creator,
                format!("NFT for token ID {}", new_token.id),
            );
        }

        new_token.id
    }

    #[action]
    fn disable_burnability(token_id: u32) {
        let mut token = Token::get_assert(token_id);
        token.check_owner_is_sender();
        token.disable_burnability();
    }

    #[action]
    fn disable_transferability(token_id: u32) {
        let mut token = Token::get_assert(token_id);
        token.check_owner_is_sender();
        token.disable_transferability();
    }

    #[action]
    fn disable_recallability(token_id: u32) {
        let mut token = Token::get_assert(token_id);
        token.check_owner_is_sender();
        token.disable_recallability();
    }

    #[action]
    fn map_symbol(token_id: u32, symbol_id: AccountNumber) {
        let x = Symbol::call().getSymbol(symbol_id);
        check(x.ownerNft == get_sender(), "must be owner");
    }

    #[action]
    fn set_auto_debit(token_id: Option<u32>, enable: bool) {
        match token_id {
            Some(id) => TokenHolder::get_or_new(get_sender(), id).set_auto_debit(enable),
            None => Holder::get_or_new(get_sender()).set_auto_debit(enable),
        }
    }

    #[action]
    fn set_keep_zero_balance(token_id: Option<u32>, enable: bool) {
        match token_id {
            Some(id) => TokenHolder::get_or_new(get_sender(), id).set_keep_zero_balances(enable),
            None => Holder::get_or_new(get_sender()).set_keep_zero_balances(enable),
        }
    }

    #[action]
    fn open(token_id: u32) {
        Balance::add(get_sender(), token_id);
    }

    #[action]
    fn recall(token_id: u32, from: AccountNumber, amount: Quantity, memo: String) {
        check(amount.value > 0, "must be greater than 0");
        let sender = get_sender();
        let mut token = Token::get_assert(token_id);
        let token_settings = token.settings();

        let is_remote_recall = sender != from;
        if is_remote_recall {
            check(!token_settings.is_unrecallable(), "token is not recallable");
            token.check_owner_is_sender();
        } else {
            check(!token_settings.is_unburnable(), "token is not burnable");
        }

        token.burn(amount, from);

        Wrapper::emit()
            .history()
            .recall(token_id, amount, sender, from, memo);
    }

    #[action]
    fn mint(token_id: u32, amount: Quantity, memo: String) {
        check(amount.value > 0, "must be greater than 0");

        let mut token = Token::get_assert(token_id);
        token.check_owner_is_sender();
        token.mint(amount, get_sender());

        Wrapper::emit().history().minted(token_id, amount, memo);
    }

    #[action]
    fn credit(token_id: u32, debitor: AccountNumber, amount: Quantity, memo: String) {
        check(amount.value > 0, "must be greater than 0");

        let creditor = get_sender();
        SharedBalance::get_or_new(creditor, debitor, token_id).credit(amount);

        Wrapper::emit()
            .history()
            .credited(token_id, creditor, debitor, memo);
    }

    #[action]
    fn uncredit(token_id: u32, debitor: AccountNumber, amount: Quantity, memo: String) {
        check(amount.value > 0, "must be greater than 0");
        let creditor = get_sender();

        SharedBalance::get_or_new(creditor, debitor, token_id).uncredit(amount);

        Wrapper::emit()
            .history()
            .uncredited(token_id, creditor, debitor, memo);
    }

    #[action]
    fn debit(token_id: u32, creditor: AccountNumber, amount: Quantity, memo: String) {
        check(amount.value > 0, "must be greater than 0");
        let debitor = get_sender();

        SharedBalance::get_or_new(creditor, debitor, token_id).debit(amount);

        Wrapper::emit()
            .history()
            .debited(token_id, creditor, debitor, memo);
    }

    #[event(history)]
    pub fn recall(
        token_id: u32,
        amount: Quantity,
        sender: AccountNumber,
        burnee: AccountNumber,
        memo: String,
    ) {
    }

    #[event(history)]
    pub fn minted(token_id: u32, amount: Quantity, memo: String) {}

    #[event(history)]
    pub fn credited(token_id: u32, creditor: AccountNumber, debitor: AccountNumber, memo: String) {}

    #[event(history)]
    pub fn uncredited(
        token_id: u32,
        creditor: AccountNumber,
        debitor: AccountNumber,
        memo: String,
    ) {
    }

    #[event(history)]
    pub fn debited(token_id: u32, creditor: AccountNumber, debitor: AccountNumber, memo: String) {}
}

#[cfg(test)]
mod tests;
