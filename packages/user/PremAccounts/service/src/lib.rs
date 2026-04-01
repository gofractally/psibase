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
        /// When false, `buy` rejects new purchases for this name length; other actions are unchanged.
        pub enabled: bool,
    }

    impl Default for Auction {
        fn default() -> Self {
            Self {
                length: 0,
                nft_id: 0,
                enabled: true,
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
        #[primary_key]
        pub account: AccountNumber,
        //#[secondary_key(1)]
        pub owner: AccountNumber,
    }
}

#[psibase::service(name = "prem-accounts", tables = "tables")]
pub mod service {
    use crate::tables::{
        Auction, AuctionsTable, InitRow, InitTable, PurchasedAccount, PurchasedAccountsTable,
    };
    use psibase::fracpack::Pack;
    use psibase::services::accounts as Accounts;
    use psibase::services::auth_any::Wrapper as AuthAny;
    use psibase::services::auth_delegate as AuthDelegate;
    use psibase::services::auth_sig as AuthSig;
    use psibase::services::auth_sig::SubjectPublicKeyInfo;
    use psibase::services::diff_adjust::Wrapper as DiffAdjust;
    use psibase::services::events;
    use psibase::services::nft as Nfts;
    use psibase::services::tokens::{self as Tokens, BalanceFlags};
    use psibase::services::tokens::{Quantity, TID};
    use psibase::services::transact::Wrapper as Transact;
    use psibase::AccountNumber;
    use psibase::*;

    const INIT_DIFFICULTY: u64 = 1000;
    const MIN_NAME_MARKET_LENGTH: u8 = 1;
    const MAX_NAME_MARKET_LENGTH: u8 = 15;

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

    fn new_account(name: AccountNumber) {
        Accounts::Wrapper::call().newAccount(name, AuthAny::SERVICE, true);
        let set_owner = Action {
            sender: name,
            service: AuthDelegate::Wrapper::SERVICE,
            method: AuthDelegate::action_structs::setOwner::ACTION_NAME.into(),
            rawData: AuthDelegate::action_structs::setOwner {
                owner: get_service(),
            }
            .packed()
            .into(),
        };

        let set_auth = Action {
            sender: name,
            service: Accounts::Wrapper::SERVICE,
            method: Accounts::action_structs::setAuthServ::ACTION_NAME.into(),
            rawData: Accounts::action_structs::setAuthServ {
                authService: AuthDelegate::Wrapper::SERVICE,
            }
            .packed()
            .into(),
        };

        Transact::call().runAs(set_owner, vec![]);
        Transact::call().runAs(set_auth, vec![]);
    }

    #[action]
    fn init() {
        let table = InitTable::new();
        table.put(&InitRow {}).unwrap();
        Tokens::Wrapper::call().setUserConf(BalanceFlags::MANUAL_DEBIT.index(), true);
        Nfts::Wrapper::call().setUserConf(BalanceFlags::MANUAL_DEBIT.index(), true);

        // Bootstrap default premium markets for name lengths 1–9 (more lengths: `add_market`).
        let auctions_table = AuctionsTable::new();
        for length in 1..=9 {
            let nft_id = DiffAdjust::call().create(
                INIT_DIFFICULTY, // initial_difficulty
                86400,           // window_seconds (1 day)
                1,               // target_min
                10,              // target_max
                100,             // floor_difficulty
                50000,           // inc_ppm (5% = 50000 ppm)
                50000,           // dec_ppm (5% = 50000 ppm)
            );

            auctions_table
                .put(&Auction {
                    length,
                    nft_id,
                    enabled: true,
                })
                .unwrap();
        }
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
    /// * `account` - The account name to purchase
    #[action]
    fn buy(account: String, max_cost: u64) {
        check_init();

        let acct_to_buy = AccountNumber::from_exact(&account).expect("invalid account name");

        check(
            !Accounts::Wrapper::call().exists(acct_to_buy),
            "account already exists",
        );

        let length = account.len() as u8;
        check(
            length >= MIN_NAME_MARKET_LENGTH && length <= MAX_NAME_MARKET_LENGTH,
            "account name must be 1-15 characters",
        );

        let sys_token = check_some(
            Tokens::Wrapper::call().getSysToken(),
            "system token must be defined",
        );
        let sys_token_id: TID = sys_token.id;

        let sender = get_sender();
        let service_account = get_service();

        crate::Wrapper::emit()
            .history()
            .premAcctEvent(sender, acct_to_buy, BOUGHT);

        let auctions_table = AuctionsTable::new();
        let auction = check_some(
            auctions_table.get_index_pk().get(&length),
            "auction not found for this length",
        );

        check(auction.enabled, "market is disabled");

        let current_price = DiffAdjust::call().get_diff(auction.nft_id);

        let shared_bal =
            Tokens::Wrapper::call().getSharedBal(sys_token_id, sender, service_account);

        check(
            current_price <= shared_bal.value && current_price <= max_cost,
            "insufficient balance or max_cost too low",
        );

        new_account(acct_to_buy);

        PurchasedAccountsTable::new()
            .put(&PurchasedAccount {
                account: acct_to_buy,
                owner: sender,
            })
            .unwrap();

        let cost = Quantity::from(current_price);
        Tokens::Wrapper::call().debit(
            sys_token_id,
            sender,
            cost,
            "premium account purchase".to_string().try_into().unwrap(),
        );

        Tokens::Wrapper::call().reject(
            sys_token_id,
            sender,
            "return change".to_string().try_into().unwrap(),
        );

        // Alert the DiffAdjust service to the purchase
        DiffAdjust::call().increment(auction.nft_id, 1);
    }

    #[action]
    fn claim(account: String, pub_key: SubjectPublicKeyInfo) {
        check_init();

        let purchased_accounts_table = PurchasedAccountsTable::new();
        let acct_to_claim = AccountNumber::from_exact(&account).expect("invalid account name");

        let purchased_account = check_some(
            purchased_accounts_table.get_index_pk().get(&acct_to_claim),
            "account not purchased",
        );

        check(
            purchased_account.owner == get_sender(),
            "account not purchased by sender",
        );

        crate::Wrapper::emit()
            .history()
            .premAcctEvent(get_sender(), acct_to_claim, CLAIMED);

        let set_key_action = Action {
            sender: acct_to_claim,
            service: AuthSig::SERVICE,
            method: AuthSig::action_structs::setKey::ACTION_NAME.into(),
            rawData: AuthSig::action_structs::setKey {
                key: pub_key.into(),
            }
            .packed()
            .into(),
        };
        Transact::call().runAs(set_key_action, vec![]);

        let set_auth_serv_action = Action {
            sender: acct_to_claim,
            service: Accounts::SERVICE,
            method: Accounts::action_structs::setAuthServ::ACTION_NAME.into(),
            rawData: Accounts::action_structs::setAuthServ {
                authService: AuthSig::Wrapper::SERVICE,
            }
            .packed()
            .into(),
        };
        Transact::call().runAs(set_auth_serv_action, vec![]);

        purchased_accounts_table.remove(&purchased_account);
    }

    #[action]
    fn add_market(length: u8) {
        check_init();
        check(
            length >= MIN_NAME_MARKET_LENGTH && length <= MAX_NAME_MARKET_LENGTH,
            "market name length must be 1-15",
        );
        let auctions_table = AuctionsTable::new();
        check(
            auctions_table.get_index_pk().get(&length).is_none(),
            "market already exists",
        );
        let nft_id = DiffAdjust::call().create(INIT_DIFFICULTY, 86400, 1, 10, 100, 50000, 50000);
        auctions_table
            .put(&Auction {
                length,
                nft_id,
                enabled: true,
            })
            .unwrap();
    }

    #[action]
    fn update_market_status(length: u8, enable: bool) {
        check_init();
        check(
            length >= MIN_NAME_MARKET_LENGTH && length <= MAX_NAME_MARKET_LENGTH,
            "market name length must be 1-15",
        );
        let auctions_table = AuctionsTable::new();
        let mut auction = check_some(
            auctions_table.get_index_pk().get(&length),
            "auction not found for this length",
        );
        auction.enabled = enable;
        auctions_table.put(&auction).unwrap();
    }

    pub const BOUGHT: u8 = 0;
    pub const CLAIMED: u8 = 1;
    #[event(history)]
    fn premAcctEvent(owner: AccountNumber, account: AccountNumber, action: u8) {}
}

#[cfg(test)]
mod tests;
