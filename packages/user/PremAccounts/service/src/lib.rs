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
    #[derive(Default, Fracpack, ToSchema, SimpleObject, Serialize, Deserialize, Debug)]
    pub struct Auction {
        pub length: u8,
        pub nft_id: u32,
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
        #[primary_key]
        pub account: AccountNumber,
        #[secondary_key(1)]
        pub owner: AccountNumber,
    }
}

#[psibase::service(name = "prem-accounts", tables = "tables")]
pub mod service {
    use crate::tables::{
        Auction, AuctionsTable, InitRow, InitTable, PurchasedAccount, PurchasedAccountsTable,
    };
    use psibase::services::accounts::Wrapper as Accounts;
    use psibase::services::diff_adjust::Wrapper as DiffAdjust;
    use psibase::services::tokens::Wrapper as Tokens;
    use psibase::services::tokens::{Quantity, TID};
    use psibase::*;

    const INIT_DIFFICULTY: u64 = 1000;

    #[action]
    fn init() {
        let table = InitTable::new();
        table.put(&InitRow {}).unwrap();

        // Create DiffAdjust records for account name lengths 1 through 9
        let auctions_table = AuctionsTable::new();
        for length in 1..=9 {
            // Create a DiffAdjust rate limiter for this length
            let nft_id = DiffAdjust::call().create(
                INIT_DIFFICULTY, // initial_difficulty
                86400,           // window_seconds (1 day)
                1,               // target_min
                10,              // target_max
                100,             // floor_difficulty
                50000,           // percent_change (5% = 50000 ppm)
            );

            auctions_table.put(&Auction { length, nft_id }).unwrap();
        }
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
    /// * `account` - The account name to purchase
    #[action]
    fn buy(account: String, max_cost: u64) {
        check_init();

        let account_num = AccountNumber::from_exact(&account).expect("invalid account name");

        check(
            !Accounts::call().exists(account_num),
            "account already exists",
        );

        let length = account.len() as u8;
        check(
            length >= 1 && length <= 9,
            "account name must be 1-9 characters",
        );

        let sys_token = check_some(Tokens::call().getSysToken(), "system token must be defined");
        let sys_token_id: TID = sys_token.id;

        let sender = get_sender();
        let service_account = get_service();

        // Get the auction for this length
        let auctions_table = AuctionsTable::new();
        let auction = check_some(
            auctions_table.get_index_pk().get(&length),
            "auction not found for this length",
        );

        let current_price = DiffAdjust::call().get_diff(auction.nft_id);

        let shared_bal = Tokens::call().getSharedBal(sys_token_id, sender, service_account);

        // Check if user has sufficient balance and max_cost is acceptable
        check(
            current_price <= shared_bal.value && current_price <= max_cost,
            "insufficient balance or max_cost too low",
        );

        // Alert the DiffAdjust service to the purchase
        DiffAdjust::call().increment(auction.nft_id, 1);

        let cost = Quantity::from(current_price);
        Tokens::call().debit(
            sys_token_id,
            sender,
            cost,
            "premium account purchase".to_string().try_into().unwrap(),
        );

        Accounts::call().newAccount(account_num, PremAccounts::SERVICE, true);

        PurchasedAccountsTable::new()
            .put(&PurchasedAccount {
                account: account_num,
                owner: sender,
            })
            .unwrap();
    }

    #[action]
    fn claim(account: String) {
        check_init();

        let purchased_accounts_table = PurchasedAccountsTable::new();
        let account_num = AccountNumber::from_exact(&account).expect("invalid account name");

        let purchased_account = check_some(
            purchased_accounts_table.get_index_pk().get(&account_num),
            "account not purchased",
        );
        check(
            purchased_account.owner == get_sender(),
            "account not purchased by sender",
        );

        Accounts::call().setAuthSev(account_num, get_sender());
        purchased_accounts_table.remove(&purchased_account);
    }
}

#[cfg(test)]
mod tests;
