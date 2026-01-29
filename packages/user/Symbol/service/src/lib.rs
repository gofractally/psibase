#![allow(non_snake_case)]
#[psibase::service_tables]
pub mod tables {
    use async_graphql::{ComplexObject, SimpleObject};
    use psibase::services::diff_adjust::Wrapper as DiffAdjust;
    use psibase::services::nft::{Nft as NftRecord, Wrapper as Nft, NID};
    use psibase::services::tokens::Wrapper as Tokens;
    use psibase::services::tokens::{Decimal, Quantity, TokenRecord, TID};
    use psibase::{check, check_some, get_sender, AccountNumber, Fracpack, Table, ToSchema};
    use psibase::{check_none, get_service};
    use serde::{Deserialize, Serialize};

    use crate::service::{CREATED, MAPPED};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "SymbolLengthTable", index = 1)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug, SimpleObject)]
    #[graphql(complex)]
    pub struct SymbolLength {
        #[primary_key]
        pub symbolLength: u8,

        /// The owner of this NFT can change the price behavior for symbols of this length
        #[graphql(name = "priceNftId")]
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
            check_some(
                Self::get(symbol_length),
                format!("symbol length of {} not supported", symbol_length).as_str(),
            )
        }

        pub fn bill_sender(&self) {
            let sender = get_sender();
            let billing_token =
                check_some(Tokens::call().getSysToken(), "system token must be defined").id;

            let price = Quantity::from(DiffAdjust::call().increment(self.nftId, 1));

            if price.value > 0 {
                Tokens::call().debit(
                    billing_token,
                    sender,
                    price,
                    "symbol purchase".to_string().try_into().unwrap(),
                );
                Tokens::call().reject(billing_token, sender, "Dust return".try_into().unwrap())
            }
        }

        pub fn delete(&self) {
            DiffAdjust::call().delete(self.nftId);
            SymbolLengthTable::read_write().erase(&self.symbolLength);
        }

        pub fn add(symbol_length: u8, initial_price: u64, target: u32, floor_price: u64) -> Self {
            check_none(
                Self::get(symbol_length),
                "sale of symbol length already exists",
            );
            check(
                symbol_length >= 3 && symbol_length <= 7,
                "symbol length must be between 3 - 7 chars",
            );

            const TIME_WINDOW: u32 = 86_400; // 1 day (seconds)
            const RATE_OF_CHANGE: u32 = 50_000; // 5 percent (ppm)

            let nft_id = DiffAdjust::call().create(
                initial_price,
                TIME_WINDOW,
                target,
                target,
                floor_price,
                RATE_OF_CHANGE,
                RATE_OF_CHANGE,
            );
            let new_instance = Self::new(symbol_length, nft_id);
            new_instance.save();
            new_instance
        }

        pub fn price(&self) -> Quantity {
            DiffAdjust::call().get_diff(self.nftId).into()
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
                check_some(Tokens::call().getSysToken(), "system token must be defined").precision,
            )
        }

        pub async fn billing_token(&self) -> TokenRecord {
            check_some(Tokens::call().getSysToken(), "system token must be defined")
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
    }

    impl Symbol {
        fn new(symbolId: AccountNumber, ownerNft: NID) -> Self {
            Self { symbolId, ownerNft }
        }

        pub fn get(symbol: AccountNumber) -> Option<Self> {
            SymbolTable::read().get_index_pk().get(&symbol)
        }

        pub fn get_assert(symbol: AccountNumber) -> Self {
            check_some(Self::get(symbol), "Symbol does not exist")
        }

        pub fn add(symbol: AccountNumber, recipient: AccountNumber) -> Self {
            check_none(Symbol::get(symbol), "Symbol already exists");
            check(
                symbol.to_string().chars().all(|c| c.is_ascii_lowercase()),
                "Symbol may only contain lowercase alphabetic characters",
            );
            let sender = get_sender();

            let is_billable = sender != get_service();
            if is_billable {
                check_some(
                    SymbolLength::get(symbol.to_string().len() as u8),
                    "Symbol length is not for sale",
                )
                .bill_sender();
            }

            crate::Wrapper::emit()
                .history()
                .symEvent(symbol, sender, CREATED);

            let new_instance = Self::new(symbol, Nft::call().mint());
            new_instance.save();

            Nft::call().credit(
                new_instance.ownerNft,
                recipient,
                format!("This NFT conveys ownership of symbol: {}", symbol)
                    .as_str()
                    .into(),
            );

            new_instance
        }

        fn check_is_owner_of_nft(nft_id: NID, user: AccountNumber) {
            check(
                Nft::call().getNft(nft_id).owner == user,
                "Missing required authority",
            );
        }

        pub fn map_symbol(&mut self, token_id: TID) {
            let token_owner_nft = Tokens::call().getToken(token_id).nft_id;
            let symbol_owner_nft = self.ownerNft;
            let sender = get_sender();

            Self::check_is_owner_of_nft(token_owner_nft, sender);
            Self::check_is_owner_of_nft(symbol_owner_nft, sender);

            Nft::call().debit(symbol_owner_nft, "mapping symbol to token".into());
            Nft::call().burn(symbol_owner_nft);
            Mapping::add(token_id, self.symbolId);

            crate::Wrapper::emit()
                .history()
                .symEvent(self.symbolId, get_sender(), MAPPED);
        }

        fn save(&self) {
            SymbolTable::read_write().put(&self).unwrap();
        }
    }

    #[ComplexObject]
    impl Symbol {
        pub async fn owner_nft(&self) -> NftRecord {
            Nft::call().getNft(self.ownerNft)
        }

        pub async fn mapping(&self) -> Option<Mapping> {
            Mapping::get_by_symbol(self.symbolId)
        }
    }

    #[table(name = "MappingTable", index = 3)]
    #[derive(Default, Fracpack, ToSchema, Serialize, Deserialize, Debug, SimpleObject)]
    #[graphql(complex)]
    pub struct Mapping {
        #[primary_key]
        pub tokenId: TID,
        #[graphql(skip)]
        pub symbolId: AccountNumber,
    }

    impl Mapping {
        #[secondary_key(1)]
        fn by_symbol(&self) -> AccountNumber {
            self.symbolId
        }

        fn new(tokenId: TID, symbolId: AccountNumber) -> Self {
            Self { tokenId, symbolId }
        }

        pub fn get(tokenId: TID) -> Option<Self> {
            MappingTable::read().get_index_pk().get(&tokenId)
        }

        pub fn get_assert(tokenId: TID) -> Self {
            check_some(Self::get(tokenId), "mapping does not exist")
        }

        pub fn get_by_symbol(symbol: AccountNumber) -> Option<Self> {
            MappingTable::read().get_index_by_symbol().get(&symbol)
        }

        pub fn add(tokenId: TID, symbol: AccountNumber) {
            check_none(
                Self::get_by_symbol(symbol),
                "Symbol is already mapped to a token",
            );
            Self::new(tokenId, symbol).save();
        }

        fn save(&self) {
            MappingTable::read_write().put(&self).unwrap();
        }
    }

    #[ComplexObject]
    impl Mapping {
        pub async fn symbol(&self) -> Symbol {
            Symbol::get_assert(self.symbolId)
        }

        pub async fn token(&self) -> TokenRecord {
            Tokens::call().getToken(self.tokenId)
        }
    }
}

#[psibase::service(name = "symbol", tables = "tables")]
pub mod service {
    use crate::tables::{InitRow, InitTable, Mapping, Symbol, SymbolLength};
    use psibase::services::symbol::SID;
    use psibase::services::tokens::{BalanceFlags, Quantity, TID};
    use psibase::*;

    use psibase::services::events;

    use psibase::services::nft::{NftHolderFlags, Wrapper as Nft};
    use psibase::services::tokens::Wrapper as Tokens;

    #[action]
    fn init() {
        let table = InitTable::new();

        if InitTable::read().get_index_pk().get(&()).is_none() {
            table.put(&InitRow {}).unwrap();

            Tokens::call().setUserConf(BalanceFlags::MANUAL_DEBIT.index(), true);
            Nft::call().setUserConf(NftHolderFlags::MANUAL_DEBIT.index(), true);

            let add_index = |method: &str, column: u8| {
                events::Wrapper::call().addIndex(
                    DbId::HistoryEvent,
                    Wrapper::SERVICE,
                    MethodNumber::from(method),
                    column,
                );
            };

            add_index("symEvent", 0);
            add_index("symEvent", 1);
        }
    }

    #[action]
    fn sellLength(length: u8, initial_price: Quantity, target: u32, floor_price: Quantity) {
        check_some(Tokens::call().getSysToken(), "system token must be defined");
        check(
            get_sender() == get_service(),
            "only symbols account can sell lengths",
        );
        SymbolLength::add(length, initial_price.value, target, floor_price.value);
    }

    #[action]
    fn delLength(length: u8) {
        check(
            get_sender() == get_service(),
            "only symbols account can delete lengths",
        );
        SymbolLength::get_assert(length).delete();
    }

    #[action]
    fn create(symbol: AccountNumber) {
        Symbol::add(symbol, get_sender());
    }

    #[action]
    fn admin_create(symbol: AccountNumber, recipient: AccountNumber) {
        check(get_sender() == get_service(), "only symbol service can call this action");
        Symbol::add(symbol, recipient);
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
        Mapping::get_assert(token_id).symbolId
    }

    #[action]
    #[allow(non_snake_case)]
    fn getByToken(token_id: TID) -> Option<Mapping> {
        Mapping::get(token_id)
    }

    #[action]
    fn getMapBySym(symbol: AccountNumber) -> Option<Mapping> {
        Mapping::get_by_symbol(symbol)
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

    #[pre_action(exclude(init, getByToken))]
    fn check_init() {
        check_some(
            InitTable::read().get_index_pk().get(&()),
            "service not inited",
        );
    }

    pub const CREATED: u8 = 0;
    pub const MAPPED: u8 = 1;
    #[event(history)]
    fn symEvent(symbol: SID, actor: AccountNumber, action: u8) {}
}
