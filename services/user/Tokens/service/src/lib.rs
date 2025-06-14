pub mod flags;
pub mod tables;

#[psibase::service(tables = "tables::tables")]
pub mod service {

    use crate::tables::tables::{
        Balance, Holder, InitRow, InitTable, SharedBalance, Token, TokenHolder,
    };
    use psibase::services::nft::Wrapper as Nfts;
    use psibase::services::symbol::Service::Wrapper as Symbol;
    use psibase::{AccountNumber, Precision, Quantity};

    use psibase::{Fracpack, ToSchema};
    use serde::{Deserialize, Serialize};

    use psibase::*;

    #[derive(Fracpack, ToSchema, Serialize, Deserialize, Debug, Clone)]
    pub struct InfSettingsRecord {
        pub dailyLimitPct: u64,
        pub dailyLimitQty: u64,
        pub yearlyLimitPct: u64,
    }

    #[derive(Fracpack, ToSchema, Serialize, Deserialize, Debug, Clone)]
    pub struct InfStatsRecord {
        pub avgDaily: i64,
        pub avgYearly: i64,
    }
    #[derive(Fracpack, ToSchema, Serialize, Deserialize, Debug, Clone)]
    pub struct InflationRecord {
        pub settings: InfSettingsRecord,
        pub stats: InfStatsRecord,
    }

    #[derive(Fracpack, ToSchema, Serialize, Deserialize, Debug, Clone)]
    pub struct TokenRecord {
        pub id: u32,       // TID
        pub ownerNft: u32, // NID
        pub inflation: InflationRecord,
        pub config: u8,
        pub precision: Precision,
        pub currentSupply: Quantity,
        pub maxSupply: Quantity,
        pub symbolId: AccountNumber, // SID
    }

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

        // Give the Owner token NFT to Symbol
        Nfts::call_from(Wrapper::SERVICE).credit(
            native_token.nft_id,
            psibase::services::symbol::SERVICE,
            "Passing system token ownership".to_string(),
        );

        Nfts::call_from(Wrapper::SERVICE).setUserConf(psibase::NamedBit::from("manualDebit"), true)
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

        Wrapper::emit()
            .history()
            .created(new_token.id, get_sender(), precision, max_supply);

        new_token.id
    }

    #[action]
    fn set_token_settings(token_id: u32, settings: u8) {
        let mut token = Token::get_assert(token_id);
        token.check_owner_is_sender();
        token.set_settings(settings.into());
    }

    #[action]
    fn gettoken(token_id: u32) -> TokenRecord {
        let token = Token::get_assert(token_id);

        let inflation = InflationRecord {
            settings: InfSettingsRecord {
                dailyLimitPct: 0,
                dailyLimitQty: 0,
                yearlyLimitPct: 0,
            },
            stats: InfStatsRecord {
                avgDaily: 0,
                avgYearly: 0,
            },
        };

        TokenRecord {
            config: token.settings_value,
            currentSupply: token.current_supply,
            id: token.id,
            inflation,
            maxSupply: token.max_supply,
            ownerNft: token.nft_id,
            precision: token.precision.into(),
            symbolId: token.symbol.unwrap_or(AccountNumber::from(0)),
        }
    }

    #[action]
    fn mapsymbol(token_id: u32, symbol: AccountNumber) {
        let mut token = Token::get_assert(token_id);
        token.check_owner_is_sender();
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
    pub fn created(token_id: u32, sender: AccountNumber, precision: u8, max_supply: Quantity) {}

    #[event(history)]
    pub fn minted(token_id: u32, amount: Quantity, memo: String) {}

    #[event(history)]
    pub fn symbol_mapped(token_id: u32, sender: AccountNumber, symbol: AccountNumber) {}

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
