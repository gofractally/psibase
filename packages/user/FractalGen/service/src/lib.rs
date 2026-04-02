//! A service that creates a system fractal responsible for distributing the system token.
//! If a network is using fractal governance, this should be installed at boot.

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

#[psibase::service(name = "fractal-gen", tables = "tables")]
mod service {
    use crate::tables::ConfigRow;
    use psibase::services::{
        auth_delegate::Wrapper as AuthDelegate, fractals::Wrapper as Fractals,
        producers::Wrapper as Producers,
    };
    use psibase::*;

    const SYS_FRACTAL: AccountNumber = account!("core-frac");
    const SYS_GUILD: AccountNumber = account!("core-g1");
    const ROOT: AccountNumber = account!("root");

    #[action]
    fn create_frac() {
        check(get_sender() == Wrapper::SERVICE, "Unauthorized");

        if ConfigRow::is_init() {
            return;
        }
        ConfigRow::init();

        let prods = Producers::call().getProducers();
        let producer = prods.first().unwrap();

        Fractals::call_from(*producer).create_fractal(
            SYS_FRACTAL,
            SYS_GUILD,
            "Network Governance".into(),
            "To establish, maintain, and grow the network by increasing the utility-driven use of its native token.".into(),
            account!("c-role-001"),
            account!("r-role-001"),
        );

        // Give the core fractal ownership of the network
        AuthDelegate::call_from(ROOT).setOwner(SYS_FRACTAL);
    }
}
