const PPM_PER_PCT: u32 = 10_000;

pub fn ppm_to_pct(ppm: u32) -> u8 {
    ((ppm + PPM_PER_PCT / 2) / PPM_PER_PCT) as u8
}

pub fn pct_to_ppm(pct: u8) -> u32 {
    (pct as u32) * PPM_PER_PCT
}

#[psibase::service_tables]
pub mod tables {
    use async_graphql::{ComplexObject, SimpleObject};
    use psibase::services::diff_adjust::{RateLimit, RateLimitTable, Wrapper as DiffAdjust};
    use psibase::services::tokens::{Decimal, Precision, Quantity, Wrapper as Tokens};
    use psibase::AccountNumber;
    use psibase::{Fracpack, ServiceWrapper, Table, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "AuctionsTable", index = 1)]
    #[derive(Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    #[graphql(complex)]
    pub struct Auction {
        #[primary_key]
        pub length: u8,
        #[graphql(skip)]
        pub nft_id: u32,
        pub enabled: bool,
        #[graphql(skip)]
        pub initial_price: Quantity,
    }

    impl Auction {
        fn rate_limit(&self) -> Option<RateLimit> {
            RateLimitTable::read().get_index_pk().get(&self.nft_id)
        }

        fn sys_precision() -> Precision {
            Tokens::call()
                .getSysToken()
                .expect("system token must be defined")
                .precision
        }
    }

    #[ComplexObject]
    impl Auction {
        /// Stored create price, as a Decimal in the system token.
        pub async fn initial_price(&self) -> Decimal {
            Decimal::new(self.initial_price, Self::sys_precision())
        }

        /// DiffAdjust target (target_min == target_max in NameMarket usage).
        pub async fn target(&self) -> u32 {
            self.rate_limit().map(|r| r.target_min).unwrap_or(0)
        }

        /// Floor price from DiffAdjust, as a Decimal in the system token.
        pub async fn floor_price(&self) -> Decimal {
            Decimal::new(
                Quantity::from(self.rate_limit().map(|r| r.floor_difficulty).unwrap_or(0)),
                Self::sys_precision(),
            )
        }

        pub async fn window_seconds(&self) -> u32 {
            self.rate_limit().map(|r| r.window_seconds).unwrap_or(0)
        }

        pub async fn increase_pct(&self) -> u8 {
            crate::ppm_to_pct(self.rate_limit().map(|r| r.increase_ppm).unwrap_or(0))
        }

        pub async fn decrease_pct(&self) -> u8 {
            crate::ppm_to_pct(self.rate_limit().map(|r| r.decrease_ppm).unwrap_or(0))
        }

        /// Current ask price (DiffAdjust difficulty), as a Decimal in the system token.
        pub async fn price(&self) -> Decimal {
            let mut price_raw = DiffAdjust::call().get_diff(self.nft_id);
            if price_raw == 0 {
                price_raw = self.rate_limit().map(|r| r.floor_difficulty).unwrap_or(0);
            }
            Decimal::new(Quantity::from(price_raw), Self::sys_precision())
        }
    }

    #[table(name = "PurchasedAccountsTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct PurchasedAccount {
        #[primary_key]
        pub account: AccountNumber,
        pub owner: AccountNumber,
    }

    impl PurchasedAccount {
        #[secondary_key(1)]
        fn by_owner(&self) -> (AccountNumber, AccountNumber) {
            (self.owner, self.account)
        }
    }
}

#[psibase::service(name = "namemarket", tables = "tables")]
pub mod service {
    use crate::tables::{
        Auction, AuctionsTable, InitRow, InitTable, PurchasedAccount, PurchasedAccountsTable,
    };
    use psibase::services::accounts as Accounts;
    use psibase::services::auth_delegate as AuthDelegate;
    use psibase::services::diff_adjust::{RateLimitTable, Wrapper as DiffAdjust};
    use psibase::services::events;
    use psibase::services::nft::{self as Nfts, NftHolderFlags};
    use psibase::services::tokens::{self as Tokens, BalanceFlags};
    use psibase::services::tokens::{Quantity, TID};
    use psibase::AccountNumber;
    use psibase::*;
    use psibase::{MAX_ACCOUNT_NAME_LENGTH, MIN_ACCOUNT_NAME_LENGTH};

    fn require_caller_is_self() {
        assert!(
            get_sender() == get_service(),
            "caller must be NameMarket service",
        );
    }

    fn check_market_length(length: u8) {
        assert!(
            length >= MIN_ACCOUNT_NAME_LENGTH && length <= MAX_ACCOUNT_NAME_LENGTH,
            "market name length must be {}-{}",
            MIN_ACCOUNT_NAME_LENGTH,
            MAX_ACCOUNT_NAME_LENGTH,
        );
    }

    fn register_prem_acct_event_indices() {
        let add_index = |method: &str, column: u8| {
            events::Wrapper::call().addIndex(
                EventDb::HistoryEvent,
                get_service(),
                MethodNumber::from(method),
                column,
            );
        };
        add_index("nameMktEvent", 0);
        add_index("nameMktEvent", 1);
    }

    /// Apply full DiffAdjust admin params from `configure`.
    /// The local AuctionsTable only stores length/nft_id/enabled; all pricing params live in DiffAdjust.
    fn apply_diff_adjust_configure(
        nft_id: u32,
        window_seconds: u32,
        target: u32,
        floor_price: Quantity,
        increase_ppm: u32,
        decrease_ppm: u32,
    ) {
        DiffAdjust::call().set_window(nft_id, window_seconds);
        DiffAdjust::call().set_targets(nft_id, target, target);
        DiffAdjust::call().set_floor(nft_id, floor_price.value);
        DiffAdjust::call().set_ppm(nft_id, increase_ppm, decrease_ppm);
    }

    #[action]
    fn init() {
        let table = InitTable::new();

        table.put(&InitRow {}).unwrap();
        Tokens::Wrapper::call().setUserConf(BalanceFlags::AUTO_DEBIT.index(), false);
        Nfts::Wrapper::call().setUserConf(NftHolderFlags::AUTO_DEBIT.index(), false);

        register_prem_acct_event_indices();
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::new();
        assert!(
            table.get_index_pk().get(&()).is_some(),
            "service not inited",
        );
    }

    /// Buy a premium account name
    ///
    /// # Arguments
    /// * `account` - The account to purchase
    #[action]
    fn buy(account: AccountNumber) {
        let length = account.to_string().len() as u8;

        let sys_token_id: TID = Tokens::Wrapper::call()
            .getSysToken()
            .expect("system token must be defined")
            .id;

        let sender = get_sender();

        let auction = AuctionsTable::new()
            .get_index_pk()
            .get(&length)
            .expect("auction not found for this length");

        assert!(auction.enabled, "market is disabled");

        // Alert the DiffAdjust service to the purchase
        let current_price = Quantity::from(DiffAdjust::call().increment(auction.nft_id, 1));

        Accounts::Wrapper::call().preapproveAcc(account);
        AuthDelegate::Wrapper::call().newAccount(account, get_service(), true);

        PurchasedAccountsTable::new()
            .put(&PurchasedAccount {
                account: account,
                owner: sender,
            })
            .unwrap();

        let cost = current_price;
        Tokens::Wrapper::call().debit(sys_token_id, sender, cost, "".into());

        Tokens::Wrapper::call().reject(sys_token_id, sender, "return change".into());

        crate::Wrapper::emit()
            .history()
            .nameMktEvent(sender, account, BOUGHT);
    }

    #[action]
    fn claim(account: AccountNumber) {
        let purchased_accounts_table = PurchasedAccountsTable::new();

        let purchased_account = purchased_accounts_table
            .get_index_pk()
            .get(&account)
            .expect("account not purchased");

        assert_eq!(
            purchased_account.owner,
            get_sender(),
            "account not purchased by sender",
        );

        AuthDelegate::Wrapper::call_as(account).setOwner(get_sender());

        purchased_accounts_table.remove(&purchased_account);

        crate::Wrapper::emit()
            .history()
            .nameMktEvent(get_sender(), account.clone(), CLAIMED);
    }

    /// Create a new name-length market.
    ///
    /// # Arguments
    /// * `length` - The length of the name-length market
    /// * `initial_price` - The initial price for the name-length market
    /// * `window_seconds` - The window seconds for the name-length market
    /// * `target` - The target for the name-length market
    /// * `floor_price` - The floor price for the name-length market
    /// * `increase_ppm` - The increase ppm for the name-length market
    /// * `decrease_ppm` - The decrease ppm for the name-length market
    #[action]
    fn create(
        length: u8,
        initial_price: Quantity,
        window_seconds: u32,
        target: u32,
        floor_price: Quantity,
        increase_ppm: u32,
        decrease_ppm: u32,
    ) {
        require_caller_is_self();

        check_market_length(length);

        Tokens::Wrapper::call()
            .getSysToken()
            .expect("system token must be defined");

        let auctions_table = AuctionsTable::new();
        if let Some(auction) = auctions_table.get_index_pk().get(&length) {
            if let Some(rate_limit) = RateLimitTable::read().get_index_pk().get(&auction.nft_id) {
                if rate_limit.window_seconds == window_seconds
                    && rate_limit.target_min == target
                    && rate_limit.target_max == target
                    && rate_limit.floor_difficulty == floor_price.value
                    && rate_limit.increase_ppm == increase_ppm
                    && rate_limit.decrease_ppm == decrease_ppm
                {
                    return;
                }
            }
            abort_message("market already exists");
        }

        let nft_id = DiffAdjust::call().create(
            initial_price.value,
            window_seconds,
            target,
            target,
            floor_price.value,
            increase_ppm,
            decrease_ppm,
        );
        Nfts::Wrapper::call().debit(nft_id, "".into());
        auctions_table
            .put(&Auction {
                length,
                nft_id,
                enabled: true,
                initial_price,
            })
            .unwrap();
    }

    /// Update the params for a name-length market (stored in DiffAdjust).
    ///
    /// # Arguments
    /// * `length` - The length of the name-length market
    /// * `window_seconds` - The window seconds for the name-length market
    /// * `target` - The target for the name-length market
    /// * `floor_price` - The floor price for the name-length market
    /// * `increase_ppm` - The increase ppm for the name-length market
    /// * `decrease_ppm` - The decrease ppm for the name-length market
    #[action]
    fn configure(
        length: u8,
        window_seconds: u32,
        target: u32,
        floor_price: Quantity,
        increase_ppm: u32,
        decrease_ppm: u32,
    ) {
        require_caller_is_self();

        check_market_length(length);

        let auctions_table = AuctionsTable::new();
        let auction = auctions_table
            .get_index_pk()
            .get(&length)
            .expect("auction not found for this length");
        apply_diff_adjust_configure(
            auction.nft_id,
            window_seconds,
            target,
            floor_price,
            increase_ppm,
            decrease_ppm,
        );
    }

    fn toggle_market(length: u8, enabled: bool) {
        require_caller_is_self();

        check_market_length(length);
        let auctions_table = AuctionsTable::new();
        let mut auction = auctions_table
            .get_index_pk()
            .get(&length)
            .expect("auction not found for this length");
        if auction.enabled == enabled {
            return;
        }
        auction.enabled = enabled;
        auctions_table.put(&auction).unwrap();
    }

    /// Enable new purchases for a name-length market
    #[action]
    fn enable(length: u8) {
        toggle_market(length, true);
    }

    /// Disable new purchases for a name-length market
    #[action]
    fn disable(length: u8) {
        toggle_market(length, false);
    }

    pub const BOUGHT: u8 = 0;
    pub const CLAIMED: u8 = 1;
    #[event(history)]
    fn nameMktEvent(owner: AccountNumber, account: AccountNumber, action: u8) {}
}

#[cfg(test)]
mod tests;
