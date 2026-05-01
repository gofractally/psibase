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
        #[primary_key]
        pub length: u8,
        pub nft_id: u32,
        pub enabled: bool,
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

pub mod constants;

#[psibase::service(name = "prem-accounts", tables = "tables")]
pub mod service {
    use crate::constants::{MAX_ACCOUNT_NAME_LENGTH, MIN_ACCOUNT_NAME_LENGTH};
    use crate::tables::{
        Auction, AuctionsTable, InitRow, InitTable, PurchasedAccount, PurchasedAccountsTable,
    };
    use psibase::services::accounts as Accounts;
    use psibase::services::auth_delegate as AuthDelegate;
    use psibase::services::diff_adjust::Wrapper as DiffAdjust;
    use psibase::services::events;
    use psibase::services::nft::{self as Nfts, NftHolderFlags};
    use psibase::services::tokens::{self as Tokens, BalanceFlags};
    use psibase::services::tokens::{Quantity, TID};
    use psibase::AccountNumber;
    use psibase::*;

    /// DiffAdjust window for target semantics (30-day period).
    const MARKET_WINDOW_SECONDS: u32 = 30 * 86400;

    fn require_caller_is_self() {
        check(
            get_sender() == get_service(),
            "caller must be PremAccounts service",
        );
    }

    fn check_market_length(length: u8) {
        check(
            length >= MIN_ACCOUNT_NAME_LENGTH && length <= MAX_ACCOUNT_NAME_LENGTH,
            &format!(
                "market name length must be {}-{}",
                MIN_ACCOUNT_NAME_LENGTH, MAX_ACCOUNT_NAME_LENGTH,
            ),
        );
    }

    fn register_prem_acct_event_indices() {
        let add_index = |method: &str, column: u8| {
            events::Wrapper::call().addIndex(
                DbId::HistoryEvent,
                get_service(),
                MethodNumber::from(method),
                column,
            );
        };
        add_index("premAcctEvent", 0);
        add_index("premAcctEvent", 1);
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
            .premAcctEvent(sender, account, BOUGHT);
    }

    #[action]
    fn claim(account: AccountNumber) {
        let purchased_accounts_table = PurchasedAccountsTable::new();

        let purchased_account = check_some(
            purchased_accounts_table.get_index_pk().get(&account),
            "account not purchased",
        );

        check(
            purchased_account.owner == get_sender(),
            "account not purchased by sender",
        );

        AuthDelegate::Wrapper::call().setOwner(get_sender());

        purchased_accounts_table.remove(&purchased_account);

        crate::Wrapper::emit()
            .history()
            .premAcctEvent(get_sender(), account.clone(), CLAIMED);
    }

    #[action]
    fn create(
        length: u8,
        initial_price: Quantity,
        target: u32,
        floor_price: Quantity,
        increase_ppm: u32,
        decrease_ppm: u32,
    ) {
        require_caller_is_self();

        check_market_length(length);

        let auctions_table = AuctionsTable::new();
        check_none(
            auctions_table.get_index_pk().get(&length),
            "market already exists",
        );
        let nft_id = DiffAdjust::call().create(
            initial_price.value,
            MARKET_WINDOW_SECONDS,
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
        let auction = check_some(
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
    }

    fn toggle_market(length: u8, enabled: bool) {
        require_caller_is_self();

        check_market_length(length);
        let auctions_table = AuctionsTable::new();
        let mut auction = check_some(
            auctions_table.get_index_pk().get(&length),
            "auction not found for this length",
        );
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
    fn premAcctEvent(owner: AccountNumber, account: AccountNumber, action: u8) {}
}

#[cfg(test)]
mod tests;
