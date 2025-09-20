#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::get_sender;
    use psibase::services::diff_adjust::Wrapper as DiffAdjust;
    use psibase::services::nft::Wrapper as Nft;
    use psibase::services::tokens::{Quantity, Wrapper as Tokens, TID};
    use psibase::{check, check_none, check_some, AccountNumber, Fracpack, Table, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {
        pub token_id: TID,
    }

    impl InitRow {
        #[primary_key]
        fn pk(&self) {}

        fn new(token_id: TID) -> Self {
            Self { token_id }
        }

        pub fn add(token_id: TID) -> Self {
            let instance = Self::new(token_id);
            instance.save();
            instance
        }

        fn save(&self) {
            InitTable::new().put(&self).unwrap();
        }

        pub fn get() -> Option<Self> {
            InitTable::new().get_index_pk().get(&())
        }

        pub fn get_assert() -> Self {
            check_some(Self::get(), "init not initialised")
        }
    }

    #[table(name = "SymbolTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Symbol {
        #[primary_key]
        pub symbol: AccountNumber,
        pub nft_id: u32,
        pub token_id: Option<TID>,
    }

    impl Symbol {
        fn new(symbol: AccountNumber) -> Self {
            Self {
                symbol,
                token_id: None,
                nft_id: Nft::call().mint(),
            }
        }

        fn save(&self) {
            SymbolTable::new().put(&self).expect("failed to save");
        }

        pub fn get(symbol: AccountNumber) -> Option<Symbol> {
            SymbolTable::read().get_index_pk().get(&symbol)
        }

        pub fn add(symbol: AccountNumber) -> Self {
            let new_instance = Self::new(symbol);
            new_instance.save();
            new_instance
        }

        pub fn purchase(symbol: AccountNumber) -> u32 {
            check_none(Self::get(symbol), "symbol already exists");
            let purchaser = get_sender();

            let sale_record = check_some(
                SymbolSaleTable::read()
                    .get_index_pk()
                    .get(&(symbol.to_string().len() as u8)),
                "sale of this length does not exist",
            );

            let current_price: Quantity =
                DiffAdjust::call().increment(sale_record.nft_id, 1).into();

            Tokens::call().debit(
                InitRow::get_assert().token_id,
                purchaser,
                current_price,
                "Symbol purchase".to_string().try_into().unwrap(),
            );
            let new_symbol = Self::add(symbol);
            Nft::call().credit(
                new_symbol.nft_id,
                purchaser,
                format!("{} symbol mapping NFT", symbol),
            );

            crate::Wrapper::emit()
                .history()
                .purchased(symbol, purchaser);
            new_symbol.nft_id
        }

        fn check_sender_is_owner(&self) {
            check(
                Nft::call().getNft(self.nft_id).owner == get_sender(),
                "must be owner of mapping NFT",
            )
        }

        pub fn map_token(&mut self, token_id: u32) {
            self.check_sender_is_owner();
            check_none(self.token_id, "symbol is already mapped");
            self.token_id = Some(token_id);
            self.save();
            crate::Wrapper::emit()
                .history()
                .mapped(self.symbol, token_id);
        }
    }

    #[table(name = "SymbolSaleTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct SymbolSale {
        #[primary_key]
        pub symbol_len: u8,
        pub nft_id: u32,
    }

    impl SymbolSale {
        fn new(symbol_len: u8, nft_id: u32) -> Self {
            Self { symbol_len, nft_id }
        }

        fn save(&self) {
            SymbolSaleTable::new().put(&self).expect("failed to save");
        }

        pub fn get(symbol: u8) -> Option<SymbolSale> {
            SymbolSaleTable::read().get_index_pk().get(&symbol)
        }

        pub fn add(
            symbol_len: u8,
            initial_difficulty: u64,
            window_seconds: u32,
            target_min: u32,
            target_max: u32,
            floor_difficulty: u64,
            percent_change: u32,
        ) {
            check_none(Self::get(symbol_len), "symbol length already exists");
            check(symbol_len <= 8, "cannot sell symbols higher than 8");
            let nft_id = DiffAdjust::call().create(
                initial_difficulty,
                window_seconds,
                target_min,
                target_max,
                floor_difficulty,
                percent_change,
            );
            Self::new(symbol_len, nft_id).save();
        }
    }
}

#[psibase::service(name = "symbol", tables = "tables")]
pub mod service {
    use crate::tables::{InitRow, Symbol, SymbolSale};
    use psibase::services::nft::Wrapper as Nft;
    use psibase::services::tokens::{Precision, Wrapper as Tokens};
    use psibase::{services::tokens::Quantity, *};

    #[action]
    fn init() {
        if InitRow::get().is_none() {
            Tokens::call().setUserConf(0, true);
            Nft::call().setUserConf("manualDebit".into(), true);

            let precision = Precision::new(4).unwrap();
            let token_id = Tokens::call().create(precision, 1_000_000_000_0000.into());
            let token_nft_id = Tokens::call().getToken(token_id).nft_id;
            Nft::call().debit(token_nft_id, "Taking ownership of system token".to_string());

            Tokens::call().setTokenConf(token_id, 0, false);
            for len in 3..7 as u8 {
                SymbolSale::add(len, 1000, 86400, 10, 15, 0, 100000);
            }

            Symbol::add("psi".into()).map_token(token_id);
            InitRow::add(token_id);
        }
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        check(InitRow::get().is_some(), "service not inited");
    }

    /// Purchase a symbol
    ///
    /// # Arguments
    /// * `symbol` - Symbol to purchase
    #[action]
    fn purchase(symbol: AccountNumber) -> u32 {
        Symbol::purchase(symbol)
    }

    /// Start sale
    ///
    /// # Arguments
    /// * `len` - Length of symbols to sell
    /// * `initial_cost` - Initial cost of symbol length
    /// * `window_seconds` - Window seconds before decay
    /// * `target_min` - Minimum rate limit target
    /// * `target_max` - Maximum rate limit target
    /// * `floor_cost` - Minimum price of symbol length
    /// * `percent_change` - Percent to increment / decrement, 50000 = 5%
    #[action]
    fn start_sale(
        len: u8,
        initial_price: Quantity,
        window_seconds: u32,
        target_min: u32,
        target_max: u32,
        floor_price: Quantity,
        percent_change: u32,
    ) {
        check(get_sender() == get_service(), "must be self");

        SymbolSale::add(
            len,
            initial_price.value,
            window_seconds,
            target_min,
            target_max,
            floor_price.value,
            percent_change,
        );
    }

    /// Get Token ID
    ///
    /// # Arguments
    /// * `symbol` - Symbol to lookup by
    ///
    /// # Returns
    /// Option of Token ID, none if not mapped
    #[action]
    fn get_token_id(symbol: AccountNumber) -> Option<u32> {
        Symbol::get(symbol).map(|symbol| symbol.token_id)?
    }

    #[event(history)]
    pub fn purchased(symbol: AccountNumber, actor: AccountNumber) {}

    #[event(history)]
    pub fn mapped(symbol: AccountNumber, token_id: u32) {}
}

#[cfg(test)]
mod tests;
