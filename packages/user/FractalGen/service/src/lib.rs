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

#[psibase::service(name = "frac-gen", tables = "tables")]
mod service {
    use crate::tables::ConfigRow;
    use psibase::services::{
        auth_delegate::Wrapper as AuthDelegate,
        dyn_ld::{self, DynDep},
        fractals::FractalRole,
        fractals::Wrapper as Fractals,
        guilds::Wrapper as Guilds,
        guilds::SERVICE as GUILDS_SERVICE,
        producers::Wrapper as Producers,
    };
    use psibase::*;

    const SYS_FRACTAL: AccountNumber = account!("core-fract");
    const SYS_GUILD: AccountNumber = account!("guild-one");
    const ROOT: AccountNumber = account!("root");

    /// Re-link FractalCore plugin deps for an existing system fractal.
    /// Keep in sync with Fractals `link_fractal_core_plugin_deps`.
    fn link_core_fractal_plugin_deps() {
        let deps = vec![
            DynDep {
                name: "host".into(),
                service: account!("host"),
            },
            DynDep {
                name: "transact".into(),
                service: account!("transact"),
            },
            DynDep {
                name: "permissions".into(),
                service: account!("perms"),
            },
            DynDep {
                name: "fractals".into(),
                service: account!("fractals"),
            },
            DynDep {
                name: "guilds".into(),
                service: account!("guilds"),
            },
            DynDep {
                name: "staged-tx".into(),
                service: account!("staged-tx"),
            },
            DynDep {
                name: "accounts".into(),
                service: account!("accounts"),
            },
            DynDep {
                name: "sites".into(),
                service: account!("sites"),
            },
        ];
        dyn_ld::Wrapper::call_as(SYS_FRACTAL).link("FractalCore".into(), deps);
    }

    #[action]
    fn create_frac() {
        check(get_sender() == Wrapper::SERVICE, "Unauthorized");

        if ConfigRow::is_init() {
            // Upgrade path for chains that already created core-fract
            // before dyn-ld was linked on fractal accounts.
            link_core_fractal_plugin_deps();
            return;
        }
        ConfigRow::init();

        let prods = Producers::call().getProducers();
        let producer = prods.first().unwrap();

        let legislature = SYS_FRACTAL.with_subaccount((FractalRole::Legislature as u8).into());
        let judiciary = SYS_FRACTAL.with_subaccount((FractalRole::Judiciary as u8).into());
        let executive = SYS_FRACTAL.with_subaccount((FractalRole::Executive as u8).into());
        let recruitment = SYS_FRACTAL.with_subaccount((FractalRole::Recruitment as u8).into());

        Fractals::call_from(*producer).create_frac(
            SYS_FRACTAL,
            legislature,
            judiciary,
            executive,
            recruitment,
            "Network Governance".into(),
            "To establish, maintain, and grow the network.".into(),
        );

        let guilds = Guilds::call_from(*producer);
        guilds.create_guild(
            SYS_FRACTAL,
            SYS_GUILD,
            "Genesis".into(),
            SYS_GUILD.with_subaccount(1.into()),
            SYS_GUILD.with_subaccount(2.into()),
        );

        let map_sys_guild_to_role_occ = |role: FractalRole| {
            Guilds::call_as(SYS_FRACTAL).set_role_map(role.into(), SYS_GUILD);
            Fractals::call_as(SYS_FRACTAL).set_r_occ(role.into(), GUILDS_SERVICE);
        };

        map_sys_guild_to_role_occ(FractalRole::Legislature);
        map_sys_guild_to_role_occ(FractalRole::Judiciary);
        map_sys_guild_to_role_occ(FractalRole::Executive);
        map_sys_guild_to_role_occ(FractalRole::Recruitment);

        Guilds::call_as(SYS_FRACTAL).set_rguilds(vec![SYS_GUILD]);
        Guilds::call_as(SYS_FRACTAL).set_auto_join(true);

        // Give the core fractal ownership of the network
        AuthDelegate::call_from(ROOT).setOwner(SYS_FRACTAL);
    }
}
