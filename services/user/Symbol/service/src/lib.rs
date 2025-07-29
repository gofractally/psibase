#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;

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

    #[table(name = "SymbolLengthRecordTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct SymbolLengthRecord {
        #[primary_key]
        pub symbol_length: u8,
        pub target_created_per_day: u16,
        pub floor_price: Quantity,
        pub active_price: Quantity,

        pub create_counter: u16,
        pub last_price_update_time: TimePointSec,
    }

    impl SymbolLengthRecord {
        pub fn get(length: u8) -> Option<Self> {
            SymbolLengthRecordTable::new().get_index_pk().get(&length)
        }

        pub fn get_assert(length: u8) -> Self {
            check_some(Self::get(length), "symbol length does not exist")
        }

        pub fn update_price(&mut self) {
            let now = TransactSvc::call().currentBlock().time.seconds();
            let seconds_elasped = (now.seconds - self.last_price_update_time.seconds) as u32;

            let days_elapsed = seconds_elasped / 86400;

            if days_elapsed > 0 {
                let seconds_remainder = seconds_elasped % 86400;
                self.create_counter = 0;
                self.last_price_update_time = (now.seconds - seconds_remainder as i64).into();

                let below_target = self.create_counter < self.target_created_per_day;
                if below_target {
                    let percent = (100 - ConfigRow::get_assert().decrease_percent) as u64;
                    let new_price = self.active_price.value * percent.pow(days_elapsed)
                        / 100u64.pow(days_elapsed);
                    let new_price = new_price.max(self.floor_price.value);

                    self.active_price = new_price.into();
                }
            }

            if self.create_counter > self.target_created_per_day {
                let percent = (100 + ConfigRow::get_assert().increase_percent) as u64;
                self.active_price = (self.active_price.value * percent / 100).into();
                self.create_counter = 0;
                self.last_price_update_time = now;
            }

            self.save();
        }

        pub fn populate_default() {
            let now = TransactSvc::call().currentBlock().time.seconds();

            for symbol_length in 3u8..7 {
                let symbol = Self {
                    symbol_length,
                    active_price: 10000000.into(),
                    floor_price: 1000000.into(),
                    target_created_per_day: 24,
                    create_counter: 0,
                    last_price_update_time: now,
                };
                symbol.save();
            }
        }

        fn save(&self) {
            SymbolLengthRecordTable::new().put(&self).unwrap();
        }
    }

    #[table(name = "SymbolTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct SymbolRecord {
        #[primary_key]
        pub symbol: psibase::AccountNumber,
        pub nft_id: NID,
    }

    impl SymbolRecord {
        pub fn get(symbol: AccountNumber) -> Option<Self> {
            SymbolTable::new().get_index_pk().get(&symbol)
        }

        pub fn get_assert(symbol: AccountNumber) -> Self {
            check_some(Self::get(symbol), "Symbol does not exist")
        }

        pub fn length(&self) -> SymbolLengthRecord {
            let length = self.symbol.to_string().chars().count();
            check_some(
                SymbolLengthRecord::get(length.try_into().unwrap()),
                "symbol of this length not for sale",
            )
        }

        pub fn add(symbol: AccountNumber, max_debit: Quantity) {
            check_none(SymbolRecord::get(symbol), "Symbol already exists");
            let symbol_length = symbol.to_string().chars().count();
            check(
                symbol_length >= 3
                    && symbol_length <= 7
                    && symbol.to_string().chars().all(|c| c.is_alphabetic()),
                "Symbol may only contain 3 to 7 lowercase alphabetic characters",
            );

            let symbol_record = Self {
                symbol,
                nft_id: Nft::call().mint(),
            };
            SymbolTable::new().put(&symbol_record).unwrap();

            let mut symbol_length = symbol_record.length();
            symbol_length.create_counter = symbol_length.create_counter + 1;
            symbol_length.save();

            let sender = get_sender();
            let is_self = sender == SERVICE;
            if is_self {
                crate::Wrapper::emit()
                    .history()
                    .symCreated(symbol, sender, 0.into());
            } else {
                let cost = symbol_length.active_price;
                check(
                    cost <= max_debit,
                    &format!(
                        "Insufficient balance, the sender is {}, the service is {}",
                        sender, SERVICE
                    ),
                );
                Tokens::call().debit(
                    psibase::services::tokens::SYS_TOKEN,
                    sender,
                    cost,
                    format!("Purchase of {}", symbol_record.symbol)
                        .try_into()
                        .unwrap(),
                );

                Nft::call().credit(
                    symbol_record.nft_id,
                    sender,
                    format!("Symbol owner NFT: {}", symbol_record.symbol),
                );
                crate::Wrapper::emit()
                    .history()
                    .symCreated(symbol, sender, cost);
            }
        }
    }
}

#[psibase::service(name = "symbol", tables = "tables")]
pub mod service {
    use crate::tables::{ConfigRow, SymbolLengthRecord, SymbolRecord};
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
        SymbolLengthRecord::populate_default();

        SymbolRecord::add("psi".into(), 0.into());
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        check(ConfigRow::exists(), "service not inited");
    }

    #[action]
    #[allow(non_snake_case)]
    fn create(new_symbol: AccountNumber, max_debit: Quantity) {
        updatePrices();
        SymbolRecord::add(new_symbol, max_debit);
    }

    #[action]
    #[allow(non_snake_case)]
    fn exists(symbol: AccountNumber) -> bool {
        SymbolRecord::get(symbol).is_some()
    }

    #[action]
    #[allow(non_snake_case)]
    fn getSymbol(symbol: AccountNumber) -> SymbolRecord {
        SymbolRecord::get_assert(symbol)
    }

    #[action]
    #[allow(non_snake_case)]
    fn getPrice(numChars: u8) -> Quantity {
        updatePrices();
        SymbolLengthRecord::get_assert(numChars).active_price
    }

    #[action]
    #[allow(non_snake_case)]
    fn getSymType(numChars: u8) -> SymbolLengthRecord {
        updatePrices();
        SymbolLengthRecord::get_assert(numChars)
    }

    #[action]
    #[allow(non_snake_case)]
    fn updatePrices() {
        for num in 3u8..7 {
            SymbolLengthRecord::get_assert(num).update_price();
        }
    }

    #[event(history)]
    fn symCreated(symbol: AccountNumber, owner: AccountNumber, cost: Quantity) {}
}

#[cfg(test)]
mod tests;
