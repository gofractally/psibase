#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;

    use psibase::services;
    use psibase::services::nft::Wrapper as Nft;
    use psibase::services::tokens::Wrapper as Tokens;
    use psibase::services::transact::Wrapper as TransactSvc;
    use psibase::{
        check, check_none, check_some, get_sender,
        services::{nft::NID, symbol::SERVICE, tokens::Quantity},
        AccountNumber, Fracpack, Table, TimePointSec, ToSchema,
    };

    use serde::{Deserialize, Serialize};

    #[table(name = "ConfigTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct ConfigRow {
        pub increase_percent: u8,
        pub decrease_percent: u8,
    }

    impl ConfigRow {
        #[primary_key]
        fn pk(&self) {}

        pub fn exists() -> bool {
            ConfigTable::new().get_index_pk().get(&()).is_some()
        }

        pub fn get() -> Option<Self> {
            ConfigTable::new().get_index_pk().get(&())
        }

        pub fn get_assert() -> Self {
            check_some(Self::get(), "config does not exist")
        }

        pub fn populate_default() {
            let table = ConfigTable::new();

            let instance = Self {
                decrease_percent: 5,
                increase_percent: 5,
            };
            table.put(&instance).unwrap();
        }
    }

    #[table(name = "SymbolLengthTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct SymbolLength {
        #[primary_key]
        pub symbol_length: u8,
        pub target_created_per_day: u16,
        pub floor_price: Quantity,
        pub active_price: Quantity,

        pub create_counter: u16,
        pub price_updated: TimePointSec,
    }

    impl SymbolLength {
        pub fn get(length: u8) -> Option<Self> {
            SymbolLengthTable::new().get_index_pk().get(&length)
        }

        pub fn get_assert(length: u8) -> Self {
            check_some(Self::get(length), "symbol length does not exist")
        }

        pub fn update_price(&mut self) {
            let now = TransactSvc::call().currentBlock().time.seconds();
            let seconds_elasped = (now.seconds - self.price_updated.seconds) as u32;

            let days_elasped = seconds_elasped / 86400;
            let seconds_remainder = seconds_elasped % 86400;

            // Either decrease the price due to time + lack of demand;
            if days_elasped > 0 {
                self.create_counter = 0;
                self.price_updated = (now.seconds - seconds_remainder as i64).into();

                let below_target = self.create_counter < self.target_created_per_day;
                if below_target {
                    let decrease_percent = ConfigRow::populate_default();
                }
            }

            // Increase the price due to demand;
        }

        pub fn populate_default() {
            let now = TransactSvc::call().currentBlock().time.seconds();

            for symbol_length in 3u8..7 {
                let symbol = Self {
                    symbol_length,
                    active_price: 1000000.into(),
                    floor_price: 100000.into(),
                    target_created_per_day: (symbol_length * 5) as u16,
                    create_counter: 0,
                    price_updated: now,
                };
                symbol.save();
            }
        }

        pub fn new_purchase(&mut self) {
            // handle the new purchase

            self.create_counter = self.create_counter + 1;
            self.price_updated = TransactSvc::call().currentBlock().time.seconds();
            // increase the counter of the symbol record
            // set the last price update record
        }

        fn save(&self) {
            SymbolLengthTable::new().put(&self).unwrap();
        }
    }

    #[table(name = "SymbolTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Symbol {
        #[primary_key]
        pub symbol: psibase::AccountNumber,
        pub nft_id: NID,
    }

    impl Symbol {
        pub fn get(symbol: AccountNumber) -> Option<Self> {
            SymbolTable::new().get_index_pk().get(&symbol)
        }

        pub fn get_assert(symbol: AccountNumber) -> Self {
            check_some(Self::get(symbol), "symbol does not exist")
        }

        pub fn length(&self) -> SymbolLength {
            let length = self.symbol.to_string().chars().count();
            check_some(
                SymbolLength::get(length.try_into().unwrap()),
                "symbol of this length not for sale",
            )
        }

        pub fn add(symbol: AccountNumber, max_debit: Quantity) {
            check_none(Symbol::get(symbol), "symbol already exists");

            let symbol_record = Self {
                symbol,
                nft_id: Nft::call_from(SERVICE).mint(),
            };
            SymbolTable::new().put(&symbol_record).unwrap();

            let mut symbol_length = symbol_record.length();
            symbol_length.new_purchase();

            let sender = get_sender();
            let is_self = sender != SERVICE;
            if !is_self {
                let cost = symbol_length.active_price;
                check(cost <= max_debit, "Insufficient balance");
                Tokens::call_from(SERVICE).debit(
                    services::tokens::SYS_TOKEN,
                    sender,
                    cost,
                    format!("Purchase of {}", symbol_record.symbol)
                        .try_into()
                        .unwrap(),
                );

                Nft::call_from(SERVICE).credit(
                    symbol_record.nft_id,
                    sender,
                    format!("Symbol owner NFT: {}", symbol_record.symbol),
                )
            }

            // make the symbol_created event
        }
    }
}

#[psibase::service(name = "symbol", tables = "tables")]
pub mod service {
    use crate::tables::{ConfigRow, Symbol, SymbolLength};
    use psibase::*;

    use services::tokens::Quantity;
    pub type SID = psibase::AccountNumber;
    use psibase::services::nft::Wrapper as Nft;

    use psibase::services::tokens::{Precision, Wrapper as Tokens};

    #[action]
    fn init() {
        if ConfigRow::get().is_some() {
            return;
        }
        ConfigRow::populate_default();

        // Configure manual debit
        Tokens::call_from(Wrapper::SERVICE).setUserConf(services::tokens::MANUAL_DEBIT, true);
        Nft::call_from(Wrapper::SERVICE).setUserConf("manualDebit".into(), true);

        // Create system token
        let system_token_precision = Precision::new(4).unwrap();
        let system_token_id = Tokens::call_from(Wrapper::SERVICE)
            .create(system_token_precision, 10000000000000.into());

        check(
            system_token_id == services::tokens::SYS_TOKEN,
            "expected matching ID",
        );
        let nft_id = Tokens::call().getToken(system_token_id).nft_id;
        Nft::call_from(Wrapper::SERVICE).debit(nft_id, "Taking ownership of system token".into());

        // Make system token untransferable
        Tokens::call_from(Wrapper::SERVICE).setTokenConf(
            system_token_id,
            services::tokens::UNTRANSFERABLE,
            true,
        );

        // Populate default settings for each token symbol length
        SymbolLength::populate_default();

        Wrapper::call().create("psi".into(), 1.into())
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        check(ConfigRow::exists(), "service not inited");
    }

    #[action]
    #[allow(non_snake_case)]
    fn create(new_symbol: AccountNumber, max_debit: Quantity) {
        Symbol::add(new_symbol, max_debit)
    }

    #[action]
    #[allow(non_snake_case)]
    fn listSymbol(symbol: AccountNumber, price: Quantity) {
        unimplemented!()
    }

    #[action]
    #[allow(non_snake_case)]
    fn buySymbol(symbol: AccountNumber) {
        unimplemented!()
    }

    #[action]
    #[allow(non_snake_case)]
    fn unlistSymbol(symbol: AccountNumber) {
        unimplemented!()
    }

    #[action]
    #[allow(non_snake_case)]
    fn exists(symbol: AccountNumber) -> bool {
        unimplemented!()
    }

    #[action]
    #[allow(non_snake_case)]
    fn getSymbol(symbol: AccountNumber) -> Symbol {
        unimplemented!()
    }

    #[action]
    #[allow(non_snake_case)]
    fn getSymbolType(numChars: u8) -> SymbolLength {
        unimplemented!()
    }

    #[action]
    #[allow(non_snake_case)]
    fn updatePrices() {
        unimplemented!()
    }

    #[event(history)]
    pub fn updated(old_thing: String, new_thing: String) {}
}

#[cfg(test)]
mod tests;
