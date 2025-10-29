const SYSTEM_TOKEN: u32 = 1;

#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::services::nft::Wrapper as Nft;
    use psibase::services::tokens::Quantity;
    use psibase::{
        check, check_none, check_some, get_sender,
        services::{nft::NID, tokens::TID},
        AccountNumber, Fracpack, Table, ToSchema,
    };
    use serde::{Deserialize, Serialize};

    use crate::SYSTEM_TOKEN;

    #[table(name = "SymbolLengthTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
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
            let nft_id =
                psibase::services::diff_adjust::Wrapper::call().create(123, 86400, 5, 10, 0, 50000);
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

    #[table(name = "SymbolTable", index = 1)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Symbol {
        #[primary_key]
        pub symbolId: AccountNumber,
        pub ownerNft: NID,
        pub tokenId: Option<TID>,
    }

    impl Symbol {
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

        pub fn add(symbol: AccountNumber, billable: bool) -> Self {
            let length_record = check_some(
                SymbolLength::get(symbol.to_string().len() as u8),
                "symbol length not supported",
            );

            if billable {
                let price = psibase::services::diff_adjust::Wrapper::call()
                    .increment(length_record.nftId, 1)
                    .into();

                let owner = get_sender();
                psibase::services::tokens::Wrapper::call().debit(
                    SYSTEM_TOKEN,
                    owner,
                    price,
                    "symbol purchase".to_string().try_into().unwrap(),
                );

                crate::Wrapper::emit()
                    .history()
                    .symCreated(symbol, owner, price);
            }

            let new_instance = Self::new(symbol, Nft::call().mint());
            new_instance.save();

            new_instance
        }

        pub fn map_token(&mut self, token_id: TID) {
            check_none(self.tokenId, "Symbol already exists");
            let nft = Nft::call().getNft(self.ownerNft);
            check(nft.owner == get_sender(), "only owner can map token");
            self.tokenId = Some(token_id);
            self.save();
        }

        fn save(&self) {
            SymbolTable::read_write().put(&self).unwrap();
        }
    }
}

#[psibase::service(name = "symbol", tables = "tables")]
pub mod service {
    use crate::tables::{Symbol, SymbolLength};
    use crate::SYSTEM_TOKEN;
    use psibase::services::tokens::{Quantity, TID};
    use psibase::*;

    use psibase::services::nft::Wrapper as Nft;
    use psibase::services::tokens::Precision;
    use psibase::services::tokens::Wrapper as Tokens;

    #[action]
    fn init() {
        Tokens::call_from(Wrapper::SERVICE).setUserConf(0, true);
        Nft::call_from(Wrapper::SERVICE).setUserConf("manualDebit".into(), true);

        // Create system token
        let system_token_precision = Precision::new(4).unwrap();
        let system_token_id = Tokens::call_from(Wrapper::SERVICE)
            .create(system_token_precision, 10000000000000.into());

        check(system_token_id == SYSTEM_TOKEN, "expected matching ID");

        let system_token_nft_id = Tokens::call_from(Wrapper::SERVICE)
            .getToken(system_token_id)
            .nft_id;
        Nft::call_from(Wrapper::SERVICE).debit(
            system_token_nft_id,
            "Taking ownership of system token".into(),
        );

        // Make system token untransferable
        Tokens::call_from(Wrapper::SERVICE).setTokenConf(system_token_id, 0, true);

        // Populate default settings for each token symbol length
        for length in 3u8..7 {
            SymbolLength::add(length);
        }

        // Map PSI as the system token symbol
        let symbol = "psi".into();
        let mut symbol_record = Symbol::add(symbol, false);
        symbol_record.map_token(system_token_id);

        Nft::call_from(Wrapper::SERVICE).credit(
            symbol_record.ownerNft,
            psibase::services::tokens::SERVICE,
            "System token symbol ownership nft".into(),
        );
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
    fn exists(symbol: AccountNumber) -> bool {
        Symbol::get(symbol).is_some()
    }

    #[action]
    #[allow(non_snake_case)]
    fn mapSymbol(token_id: TID, symbol: AccountNumber) {
        Symbol::get_assert(symbol).map_token(token_id);
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        check(
            Tokens::call_from(Wrapper::SERVICE)
                .getToken(SYSTEM_TOKEN)
                .nft_id
                != 0,
            "service not initialized",
        );
    }

    #[event(history)]
    fn symCreated(symbol: AccountNumber, owner: AccountNumber, cost: Quantity) {}
}

#[cfg(test)]
mod tests;
