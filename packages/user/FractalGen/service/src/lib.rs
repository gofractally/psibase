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
        guilds::Wrapper as Guilds, guilds::SERVICE as GUILDS_SERVICE,
        producers::Wrapper as Producers,
    };
    use psibase::*;

    const SYS_FRACTAL: AccountNumber = account!("core-fract");
    const SYS_GUILD: AccountNumber = account!("core-gld-1");
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

        let legislature = "legislature".into();
        let judiciary = "judiciary-a".into();
        let executive = "executive-a".into();

        Fractals::call_from(*producer).create_frac(
            SYS_FRACTAL,
            legislature,
            judiciary,
            executive,
            "Network Governance".into(),
            "To establish, maintain, and grow the network.".into(),
        );

        let guilds = Guilds::call_from(*producer);
        guilds.create_guild(
            SYS_FRACTAL,
            SYS_GUILD,
            "Genesis".into(),
            "c-role-001".into(),
            "r-role-001".into(),
        );

        Guilds::call_from(SYS_FRACTAL).set_role_map(1, SYS_GUILD);
        Guilds::call_from(SYS_FRACTAL).set_role_map(2, SYS_GUILD);
        Guilds::call_from(SYS_FRACTAL).set_role_map(3, SYS_GUILD);

        Fractals::call_from(legislature).set_r_occ(SYS_FRACTAL, 1, GUILDS_SERVICE);
        Fractals::call_from(legislature).set_r_occ(SYS_FRACTAL, 2, GUILDS_SERVICE);
        Fractals::call_from(legislature).set_r_occ(SYS_FRACTAL, 3, GUILDS_SERVICE);

        // Give the core fractal ownership of the network
        AuthDelegate::call_from(ROOT).setOwner(SYS_FRACTAL);
    }
}
