#[psibase::service_tables]
pub mod tables {
    use async_graphql::{ComplexObject, SimpleObject};
    use psibase::check_none;
    use psibase::services::nft::{NftRecord, Wrapper as Nft};
    use psibase::services::tokens::Wrapper as Tokens;
    use psibase::services::tokens::{Decimal, Quantity};
    use psibase::{
        check, check_some, get_sender,
        services::{nft::NID, tokens::TID},
        AccountNumber, Fracpack, Table, ToSchema,
    };
    use serde::{Deserialize, Serialize};

    #[table(name = "ConfigTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct Config {
        pub billing_token: TID,
    }

    impl Config {
        #[primary_key]
        fn pk(&self) {}

        fn new(billing_token: TID) -> Self {
            Self { billing_token }
        }

        pub fn add(billing_token: TID) -> Self {
            let new_instance = Self::new(billing_token);
            new_instance.save();
            new_instance
        }

        pub fn get() -> Option<Self> {
            ConfigTable::read().get_index_pk().get(&())
        }

        pub fn get_assert() -> Self {
            check_some(Self::get(), "Config not found")
        }

        pub fn save(&self) {
            ConfigTable::read_write().put(&self).unwrap();
        }
    }

    #[table(name = "SymbolLengthTable", index = 1)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug, SimpleObject)]
    #[graphql(complex)]
    pub struct SymbolLength {
        #[primary_key]
        pub symbolLength: u8,
        pub nftId: NID,
    }

    impl SymbolLength {
        fn new(symbolLength: u8, nftId: NID) -> Self {
            Self {
                symbolLength,
                nftId,
            }
        }

        pub fn get(symbol_length: u8) -> Option<Self> {
            SymbolLengthTable::read().get_index_pk().get(&symbol_length)
        }

        pub fn get_assert(symbol_length: u8) -> Self {
            check_some(Self::get(symbol_length), "symbol length not supported")
        }

        pub fn add(symbol_length: u8) -> Self {
            let nft_id = psibase::services::diff_adjust::Wrapper::call()
                .create(10000000, 86400, 24, 24, 0, 50000);
            let new_instance = Self::new(symbol_length, nft_id);
            new_instance.save();
            new_instance
        }

        pub fn price(&self) -> Quantity {
            psibase::services::diff_adjust::Wrapper::call()
                .get_diff(self.nftId)
                .into()
        }

        fn save(&self) {
            SymbolLengthTable::read_write().put(&self).unwrap();
        }
    }

    #[ComplexObject]
    impl SymbolLength {
        pub async fn current_price(&self) -> Decimal {
            Decimal::new(
                self.price(),
                Tokens::call()
                    .getToken(Config::get_assert().billing_token)
                    .precision,
            )
        }
    }

    #[table(name = "SymbolTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, Serialize, Deserialize, Debug, SimpleObject)]
    #[graphql(complex)]
    pub struct Symbol {
        #[primary_key]
        pub symbolId: AccountNumber,
        #[graphql(skip)]
        pub ownerNft: NID,
        pub tokenId: Option<TID>,
    }

    impl Symbol {
        #[secondary_key(1)]
        fn by_token(&self) -> (Option<TID>, AccountNumber) {
            (self.tokenId, self.symbolId)
        }

        fn new(symbolId: AccountNumber, ownerNft: NID) -> Self {
            Self {
                symbolId,
                ownerNft,
                tokenId: None,
            }
        }

        pub fn get(symbol: AccountNumber) -> Option<Self> {
            SymbolTable::read().get_index_pk().get(&symbol)
        }

        pub fn get_assert(symbol: AccountNumber) -> Self {
            check_some(Self::get(symbol), "Symbol does not exist")
        }

        pub fn get_by_token(token_id: TID) -> Option<Self> {
            let mut symbols: Vec<Symbol> = SymbolTable::read()
                .get_index_by_token()
                .range(
                    (Some(token_id), AccountNumber::new(0))
                        ..=(Some(token_id), AccountNumber::new(u64::MAX)),
                )
                .collect();

            symbols.pop()
        }

        pub fn add(symbol: AccountNumber, billable: bool) -> Self {
            check_none(Symbol::get(symbol), "Symbol already exists");
            let length_record = SymbolLength::get(symbol.to_string().len() as u8);
            check(
                length_record.is_some()
                    && symbol.to_string().chars().all(|c| c.is_ascii_lowercase()),
                "Symbol may only contain 3 to 7 lowercase alphabetic characters",
            );
            let length_record = length_record.unwrap();
            let recipient = get_sender();
            let billing_token = Config::get_assert().billing_token;

            let on_created = |quantity: Quantity| {
                crate::Wrapper::emit().history().symCreated(
                    symbol,
                    recipient,
                    Decimal::new(quantity, Tokens::call().getToken(billing_token).precision)
                        .to_string(),
                );
            };

            if billable {
                let price = psibase::services::diff_adjust::Wrapper::call()
                    .increment(length_record.nftId, 1)
                    .into();

                Tokens::call().debit(
                    billing_token,
                    recipient,
                    price,
                    "symbol purchase".to_string().try_into().unwrap(),
                );

                on_created(price);
            } else {
                on_created(0.into());
            }

            let new_instance = Self::new(symbol, Nft::call().mint());
            new_instance.save();

            Nft::call().credit(
                new_instance.ownerNft,
                recipient,
                format!("This NFT conveys ownership of symbol: {}", symbol).into(),
            );

            new_instance
        }

        pub fn map_symbol(&mut self, token_id: TID) {
            let token_owner_nft = Tokens::call().getToken(token_id).nft_id;
            check(
                Nft::call().getNft(token_owner_nft).owner == get_sender(),
                "Missing required authority",
            );

            let symbol_owner_nft = self.ownerNft;
            Nft::call().debit(symbol_owner_nft, "mapping symbol to token".into());
            Nft::call().burn(symbol_owner_nft);
            self.tokenId = Some(token_id);
            self.save();
        }

        fn save(&self) {
            SymbolTable::read_write().put(&self).unwrap();
        }
    }

    #[ComplexObject]
    impl Symbol {
        pub async fn owner_nft(&self) -> NftRecord {
            psibase::services::nft::Wrapper::call().getNft(self.ownerNft)
        }
    }
}

#[psibase::service(name = "symbol", tables = "tables")]
pub mod service {
    use crate::tables::{Config, Symbol, SymbolLength};
    use psibase::services::symbol::SID;
    use psibase::services::tokens::{Quantity, TID};
    use psibase::*;

    use psibase::services::nft::Wrapper as Nft;
    use psibase::services::tokens::Wrapper as Tokens;

    #[action]
    fn init(billing_token: TID) {
        Tokens::call().getToken(billing_token); // Validate token exists
        check_none(Config::get(), "service already initialized");
        check(
            get_sender() == "root".into() || get_sender() == Wrapper::SERVICE,
            "only root account can call init",
        );

        Config::add(billing_token);
        Tokens::call_from(Wrapper::SERVICE).setUserConf(0, true);
        Nft::call_from(Wrapper::SERVICE).setUserConf("manualDebit".into(), true);

        // Populate default settings for each token symbol length
        for length in 3u8..7 {
            SymbolLength::add(length);
        }
    }

    #[action]
    fn create(symbol: AccountNumber) {
        Symbol::add(symbol, true);
    }

    #[action]
    #[allow(non_snake_case)]
    fn getPrice(length: u8) -> Quantity {
        SymbolLength::get_assert(length).price()
    }

    #[action]
    #[allow(non_snake_case)]
    fn getSymbolType(length: u8) -> SymbolLength {
        SymbolLength::get_assert(length)
    }

    #[action]
    #[allow(non_snake_case)]
    fn getSymbol(symbol: AccountNumber) -> Symbol {
        Symbol::get_assert(symbol)
    }

    #[action]
    #[allow(non_snake_case)]
    fn getTokenSym(token_id: TID) -> SID {
        Symbol::get_by_token(token_id).unwrap().symbolId
    }

    #[action]
    #[allow(non_snake_case)]
    fn getByToken(token_id: TID) -> Option<Symbol> {
        Symbol::get_by_token(token_id)
    }

    #[action]
    fn exists(symbol: AccountNumber) -> bool {
        Symbol::get(symbol).is_some()
    }

    #[action]
    #[allow(non_snake_case)]
    fn mapSymbol(token_id: TID, symbol: AccountNumber) {
        Symbol::get_assert(symbol).map_symbol(token_id);
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        check_some(Config::get(), "service not initialized");
    }

    #[event(history)]
    fn symCreated(symbol: SID, owner: AccountNumber, cost: String) {}
}

#[cfg(test)]
mod tests;
