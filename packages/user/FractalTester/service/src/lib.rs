/// Creates 18 auth-any test accounts and adds them as guild members of the
/// system fractal's genesis guild (created by FractalGen).
/// Not for production use.
///
/// Accounts created: `testfrac01` through `testfrac18`.
///
/// The setup flow:
/// 1. Create 18 accounts with `auth-any`.
/// 2. Apply each to the system guild (`core-gld-1`).
/// 3. Look up the first producer and attest each application as that producer.

#[psibase::service_tables]
pub mod tables {
    use psibase::{Fracpack, Table, ToSchema};
    use serde::{Deserialize, Serialize};

    #[table(name = "ConfigTable", index = 0)]
    #[derive(Default, Fracpack, ToSchema, Serialize, Deserialize, Debug)]
    pub struct ConfigRow {}
    impl ConfigRow {
        #[primary_key]
        fn pk(&self) {}
    }
    impl ConfigRow {
        pub fn is_init() -> bool {
            ConfigTable::read().get_index_pk().get(&()).is_some()
        }

        pub fn init() {
            ConfigTable::read_write().put(&ConfigRow {}).unwrap();
        }
    }
}

#[psibase::service(name = "frac-tester", tables = "tables")]
mod service {
    use crate::tables::ConfigRow;
    use psibase::services::{
        accounts::Wrapper as Accounts, guilds::Wrapper as Guilds, producers::Wrapper as Producers,
    };
    use psibase::*;

    const TEST_ACCOUNTS: [AccountNumber; 18] = [
        account!("testfrac01"),
        account!("testfrac02"),
        account!("testfrac03"),
        account!("testfrac04"),
        account!("testfrac05"),
        account!("testfrac06"),
        account!("testfrac07"),
        account!("testfrac08"),
        account!("testfrac09"),
        account!("testfrac10"),
        account!("testfrac11"),
        account!("testfrac12"),
        account!("testfrac13"),
        account!("testfrac14"),
        account!("testfrac15"),
        account!("testfrac16"),
        account!("testfrac17"),
        account!("testfrac18"),
    ];

    const SYS_GUILD: AccountNumber = account!("core-gld-1");

    #[action]
    fn setup() {
        check(get_sender() == Wrapper::SERVICE, "Unauthorized");

        if ConfigRow::is_init() {
            return;
        }
        ConfigRow::init();

        // 1. Create accounts with auth-any
        for &acct in &TEST_ACCOUNTS {
            Accounts::call().newAccount(acct, account!("auth-any"), true);
        }

        // 2. Apply each account to the system guild
        for &acct in &TEST_ACCOUNTS {
            Guilds::call_from(acct).apply_guild(SYS_GUILD, String::new());
        }

        // 3. Attest each application as the first producer (who is a guild member)
        let prods = Producers::call().getProducers();
        let producer = *prods.first().unwrap();

        for &acct in &TEST_ACCOUNTS {
            Guilds::call_from(producer).at_mem_app(SYS_GUILD, acct, String::new(), true);
        }
    }
}
