#[psibase::service_tables]
pub mod tables {
    use async_graphql::SimpleObject;
    use psibase::AccountNumber;
    use psibase::{Fracpack, ToSchema};
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
    pub struct Auction {
        pub length: u8,
        pub nft_id: u32,
        pub enabled: bool,
        pub initial_price: u64,
        pub target: u32,
        pub floor_price: u64,
        pub window_seconds: u32,
        pub increase_ppm: u32,
        pub decrease_ppm: u32,
    }

    impl Default for Auction {
        fn default() -> Self {
            Self {
                length: 0,
                nft_id: 0,
                enabled: true,
                initial_price: 0,
                target: 0,
                floor_price: 0,
                window_seconds: 0,
                increase_ppm: 0,
                decrease_ppm: 0,
            }
        }
    }

    impl Auction {
        #[primary_key]
        fn pk(&self) -> u8 {
            self.length
        }
    }

    #[table(name = "PurchasedAccountsTable", index = 2)]
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct PurchasedAccount {
        pub account: AccountNumber,
        pub owner: AccountNumber,
    }

    impl PurchasedAccount {
        #[primary_key]
        fn pk(&self) -> AccountNumber {
            self.account
        }

        #[secondary_key(1)]
        fn by_owner(&self) -> (AccountNumber, AccountNumber) {
            (self.owner, self.account)
        }
    }
}

pub mod constants;

#[psibase::service(name = "prem-accounts", tables = "tables")]
pub mod service {
    use crate::constants::{MAX_PREMIUM_NAME_LENGTH, MIN_PREMIUM_NAME_LENGTH};
    use crate::tables::{
        Auction, AuctionsTable, InitRow, InitTable, PurchasedAccount, PurchasedAccountsTable,
    };
    use psibase::services::accounts as Accounts;
    use psibase::services::auth_delegate as AuthDelegate;
    use psibase::services::auth_sig as AuthSig;
    use psibase::services::auth_sig::SubjectPublicKeyInfo;
    use psibase::services::diff_adjust::Wrapper as DiffAdjust;
    use psibase::services::events;
    use psibase::services::nft::{self as Nfts, NftHolderFlags};
    use psibase::services::tokens::{self as Tokens, BalanceFlags};
    use psibase::services::tokens::{Quantity, TID};
    use psibase::AccountNumber;
    use psibase::*;

    /// DiffAdjust window for target semantics (30-day period).
    const MARKET_WINDOW_SECONDS: u32 = 30 * 86400;

    fn register_prem_acct_event_indices() {
        let add_index = |method: &str, column: u8| {
            events::Wrapper::call().addIndex(
                DbId::HistoryEvent,
                Wrapper::SERVICE,
                MethodNumber::from(method),
                column,
            );
        };
        add_index("premAcctEvent", 0);
        add_index("premAcctEvent", 1);
    }

    /// Apply full DiffAdjust admin params from `configure`.
    /// Does not set active difficulty; price evolves soley via sales and decay after market creation.
    fn apply_diff_adjust_configure(
        nft_id: u32,
        window_seconds: u32,
        target: u32,
        floor_price: u64,
        increase_ppm: u32,
        decrease_ppm: u32,
    ) {
        DiffAdjust::call().set_window(nft_id, window_seconds);
        DiffAdjust::call().set_targets(nft_id, target, target);
        DiffAdjust::call().set_floor(nft_id, floor_price);
        DiffAdjust::call().set_ppm(nft_id, increase_ppm, decrease_ppm);
    }

    fn require_caller_is_self() -> bool {
        return get_sender() == Wrapper::SERVICE;
    }

    #[action]
    fn init() {
        let table = InitTable::new();
        table.put(&InitRow {}).unwrap();
        Tokens::Wrapper::call().setUserConf(BalanceFlags::MANUAL_DEBIT.index(), true);
        Nfts::Wrapper::call().setUserConf(NftHolderFlags::MANUAL_DEBIT.index(), true);

        register_prem_acct_event_indices();
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        let table = InitTable::new();
        check(
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

        let sys_token_id: TID = check_some(
            Tokens::Wrapper::call().getSysToken(),
            "system token must be defined",
        )
        .id;

        let sender = get_sender();

        let auction = check_some(
            AuctionsTable::new().get_index_pk().get(&length),
            "auction not found for this length",
        );

        check(auction.enabled, "market is disabled");

        let current_price = DiffAdjust::call().get_diff(auction.nft_id);

        let shared_bal = Tokens::Wrapper::call().getSharedBal(sys_token_id, sender, get_service());

        check(
            current_price <= shared_bal.value,
            "insufficient balance allocated for this purchase; increase max cost so it covers the current price",
        );

        Accounts::Wrapper::call().preapproveAcc(account);
        AuthDelegate::Wrapper::call().newAccount(account, get_service());

        PurchasedAccountsTable::new()
            .put(&PurchasedAccount {
                account: account,
                owner: sender,
            })
            .unwrap();

        let cost = Quantity::from(current_price);
        Tokens::Wrapper::call().debit(sys_token_id, sender, cost, "".into());

        Tokens::Wrapper::call().reject(sys_token_id, sender, "return change".into());

        // Alert the DiffAdjust service to the purchase
        DiffAdjust::call().increment(auction.nft_id, 1);

        crate::Wrapper::emit()
            .history()
            .premAcctEvent(sender, account, BOUGHT);
    }

    #[action]
    fn claim(account: AccountNumber, pub_key: SubjectPublicKeyInfo) {
        let purchased_accounts_table = PurchasedAccountsTable::new();

        let purchased_account = check_some(
            purchased_accounts_table.get_index_pk().get(&account),
            "account not purchased",
        );

        check(
            purchased_account.owner == get_sender(),
            "account not purchased by sender",
        );

        AuthSig::Wrapper::call_as(account).setKey(pub_key);

        Accounts::Wrapper::call_as(account).setAuthServ(AuthSig::Wrapper::SERVICE);

        purchased_accounts_table.remove(&purchased_account);

        crate::Wrapper::emit()
            .history()
            .premAcctEvent(get_sender(), account.clone(), CLAIMED);
    }

    #[action]
    fn create(
        length: u8,
        initial_price: u64,
        target: u32,
        floor_price: u64,
        increase_ppm: u32,
        decrease_ppm: u32,
    ) {
        require_caller_is_self();

        check(
            length >= MIN_PREMIUM_NAME_LENGTH && length <= MAX_PREMIUM_NAME_LENGTH,
            &format!(
                "market name length must be {}-{}",
                MIN_PREMIUM_NAME_LENGTH, MAX_PREMIUM_NAME_LENGTH,
            ),
        );
        let auctions_table = AuctionsTable::new();
        check(
            auctions_table.get_index_pk().get(&length).is_none(),
            "market already exists",
        );
        let nft_id = DiffAdjust::call().create(
            initial_price,
            MARKET_WINDOW_SECONDS,
            1,
            target,
            floor_price,
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
                target,
                floor_price,
                window_seconds: MARKET_WINDOW_SECONDS,
                increase_ppm,
                decrease_ppm,
            })
            .unwrap();
    }

    /// Update the params for a name-length market
    ///
    /// # Arguments
    /// * `length` - The length of the name-length market
    /// * `window_seconds` - The window seconds for the name-length market
    /// * `target` - The target for the name-length market
    /// * `floor_price` - The floor price for the name-length market
    /// * `increase_ppm` - The increase ppm for the name-length market
    /// * `decrease_ppm` - The decrease ppm for the name-length market
    ///
    /// # Note: Does not change `initial_price` or enabled status.
    #[action]
    fn configure(
        length: u8,
        window_seconds: u32,
        target: u32,
        floor_price: u64,
        increase_ppm: u32,
        decrease_ppm: u32,
    ) {
        require_caller_is_self();

        check(
            length >= MIN_PREMIUM_NAME_LENGTH && length <= MAX_PREMIUM_NAME_LENGTH,
            &format!(
                "market name length must be {}-{}",
                MIN_PREMIUM_NAME_LENGTH, MAX_PREMIUM_NAME_LENGTH,
            ),
        );
        let auctions_table = AuctionsTable::new();
        let mut auction = check_some(
            auctions_table.get_index_pk().get(&length),
            "auction not found for this length",
        );
        apply_diff_adjust_configure(
            auction.nft_id,
            window_seconds,
            target,
            floor_price,
            increase_ppm,
            decrease_ppm,
        );
        auction.target = target;
        auction.floor_price = floor_price;
        auction.window_seconds = window_seconds;
        auction.increase_ppm = increase_ppm;
        auction.decrease_ppm = decrease_ppm;
        auctions_table.put(&auction).unwrap();
    }

    /// Enable new purchases for a name-length market
    #[action]
    fn enable(length: u8) {
        require_caller_is_self();

        check(
            length >= MIN_PREMIUM_NAME_LENGTH && length <= MAX_PREMIUM_NAME_LENGTH,
            &format!(
                "market name length must be {}-{}",
                MIN_PREMIUM_NAME_LENGTH, MAX_PREMIUM_NAME_LENGTH,
            ),
        );
        let auctions_table = AuctionsTable::new();
        let mut auction = check_some(
            auctions_table.get_index_pk().get(&length),
            "auction not found for this length",
        );
        if auction.enabled {
            return;
        }
        auction.enabled = true;
        auctions_table.put(&auction).unwrap();
    }

    /// Disable new purchases for a name-length market
    #[action]
    fn disable(length: u8) {
        require_caller_is_self();

        check(
            length >= MIN_PREMIUM_NAME_LENGTH && length <= MAX_PREMIUM_NAME_LENGTH,
            &format!(
                "market name length must be {}-{}",
                MIN_PREMIUM_NAME_LENGTH, MAX_PREMIUM_NAME_LENGTH,
            ),
        );
        let auctions_table = AuctionsTable::new();
        let mut auction = check_some(
            auctions_table.get_index_pk().get(&length),
            "auction not found for this length",
        );
        auction.enabled = false;
        auctions_table.put(&auction).unwrap();
    }

    pub const BOUGHT: u8 = 0;
    pub const CLAIMED: u8 = 1;
    #[event(history)]
    fn premAcctEvent(owner: AccountNumber, account: AccountNumber, action: u8) {}
}

#[cfg(test)]
mod tests;
