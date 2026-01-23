//! A service that creates a test system token with a faucet.
//! Used for testing system token functionality.
//! Not for production use.

#[psibase::service_tables]
pub mod tables {
    use psibase::services::tokens::TID;
    use psibase::*;

    #[table(name = "ConfigTable", index = 0)]
    #[derive(ToSchema, Fracpack)]
    pub struct ConfigRow {
        pub token_id: TID,
    }
    impl ConfigRow {
        #[primary_key]
        fn pk(&self) {}
    }

    impl ConfigRow {
        pub fn check_init() {
            check(
                ConfigTable::read().get_index_pk().get(&()).is_some(),
                "service not initialized",
            );
        }

        pub fn get_sys_tid() -> TID {
            let record = check_some(
                ConfigTable::read().get_index_pk().get(&()),
                "service not initialized",
            );
            record.token_id
        }
    }
}

#[psibase::service(name = "faucet-tok", tables = "tables", recursive = true)]
mod service {
    use crate::tables::{ConfigRow, *};
    use psibase::fracpack::Pack;
    use psibase::services::{
        nft::Wrapper as Nft,
        symbol::{action_structs::admin_create, Wrapper as Symbol},
        tokens::{action_structs::setSysToken, Precision, Wrapper as Tokens},
        transact::Wrapper as Transact,
    };
    use psibase::*;

    const SYSTEM_SYMBOL: AccountNumber = account!("psi");

    #[action]
    fn create_token() {
        check(get_sender() == Tokens::SERVICE, "Unauthorized");
        let twenty_one_billion = 21_000_000_000_0000_u64;
        let id = Tokens::call().create(Precision::new(4).unwrap(), twenty_one_billion.into());

        let set_sys_token = Action {
            sender: Tokens::SERVICE,
            service: Tokens::SERVICE,
            method: MethodNumber::from(setSysToken::ACTION_NAME),
            rawData: setSysToken { tokenId: id }.packed().into(),
        };
        Transact::call().runAs(set_sys_token, vec![]);

        ConfigTable::read_write()
            .put(&ConfigRow { token_id: id })
            .unwrap();
    }

    #[action]
    fn set_symbol() {
        check(get_sender() == Symbol::SERVICE, "Unauthorized");

        let tid = ConfigRow::get_sys_tid();

        let admin_create_action = Action {
            sender: Symbol::SERVICE,
            service: Symbol::SERVICE,
            method: MethodNumber::from(admin_create::ACTION_NAME),
            rawData: admin_create {
                symbol: SYSTEM_SYMBOL,
                recipient: Wrapper::SERVICE,
            }
            .packed()
            .into(),
        };
        Transact::call().runAs(admin_create_action, vec![]);

        let s = Symbol::call().getSymbol(SYSTEM_SYMBOL);
        Nft::call().credit(s.ownerNft, Symbol::SERVICE, "".into());
        Symbol::call().mapSymbol(tid, SYSTEM_SYMBOL);
    }

    #[pre_action(exclude(create_token, set_symbol))]
    fn check_init() {
        ConfigRow::check_init();
    }

    #[action]
    fn dispense(account: AccountNumber) {
        let tid = ConfigRow::get_sys_tid();
        Tokens::call().mint(tid, 100_000_0000.into(), "".into());
        Tokens::call().credit(tid, account, 100_000_0000.into(), "Faucet drip".into());
    }
}
