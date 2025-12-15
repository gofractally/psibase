#[psibase::service_tables]
pub mod tables {
    use std::u64;

    use async_graphql::SimpleObject;
    use psibase::services::tokens::TID;
    use psibase::*;
    use serde::{Deserialize, Serialize};

    #[table(name = "InitTable", index = 0)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug)]
    pub struct InitRow {}
    impl InitRow {
        #[primary_key]
        fn pk(&self) {}
    }

    impl InitRow {
        pub fn init() {
            let table = InitTable::read_write();
            if table.get_index_pk().get(&()).is_some() {
                return;
            }
            table.put(&InitRow {}).unwrap();
        }

        pub fn check_init() {
            let table = InitTable::read();
            check(
                table.get_index_pk().get(&()).is_some(),
                "service not initialized",
            );
        }
    }

    #[table(name = "BillingConfigTable", index = 1)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug, SimpleObject, Clone)]
    pub struct BillingConfig {
        /// ID of the system token used for objective billing
        pub sys: TID,
        /// ID of the resource token
        pub res: TID,
        /// Account number that receives all resource billing fees
        pub fee_receiver: AccountNumber,
        /// Whether the resource billing system is enabled
        pub enabled: bool,
    }
    impl BillingConfig {
        #[primary_key]
        fn pk(&self) {}
    }

    /// The specs of the virtual server and the specs required by each node
    /// and are used to configure the network specs.
    #[table(name = "ServerSpecsTable", index = 2)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug, SimpleObject, Clone)]
    pub struct ServerSpecs {
        /// Amount of bandwidth capacity per second per server
        pub net_bps: u64,
        /// Amount of storage space in bytes per server
        pub storage_bytes: u64,
    }
    impl ServerSpecs {
        #[primary_key]
        fn pk(&self) {}
    }
    pub const MIN_SERVER_SPECS: ServerSpecs = ServerSpecs {
        net_bps: 1_000_000_000,        // 1 Gbps
        storage_bytes: 40_000_000_000, // 40 GB
    };
    impl Default for ServerSpecs {
        fn default() -> Self {
            MIN_SERVER_SPECS
        }
    }

    #[table(name = "NetworkVariablesTable", index = 3)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug, SimpleObject, Clone)]
    /// Variables that are used to derive the specs of the network from the server specs.
    pub struct NetworkVariables {
        /// How much faster a node replays blocks compared to the live network
        pub block_replay_factor: u8,
        /// Amount of compute nanoseconds per second consumed by system functionality
        /// that is executed on each block (`on_block` callbacks, native consensus, etc.)
        pub per_block_sys_cpu_ns: u64,
        /// Amount of storage space in bytes allocated to objective state
        pub obj_storage_bytes: u64,
    }
    impl NetworkVariables {
        #[primary_key]
        fn pk(&self) {}
    }
    impl Default for NetworkVariables {
        fn default() -> Self {
            NetworkVariables {
                block_replay_factor: 5,
                per_block_sys_cpu_ns: 20_000_000,  // 20ms
                obj_storage_bytes: 20_000_000_000, // 20 GB
            }
        }
    }

    /// The specs of the network are derived from (and necessarily lower than
    /// or equal to) the server specs due to overhead in distributing server load
    /// across network peers.
    #[table(name = "NetworkSpecsTable", index = 4)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug, SimpleObject, Clone, Default)]
    pub struct NetworkSpecs {
        /// Amount of network bandwidth capacity per second
        pub net_bps: u64,
        /// Amount of network compute nanoseconds per second
        pub cpu_ns: u64,
        /// Amount of storage space in bytes allocated to chain data
        pub obj_storage_bytes: u64,
        /// Amount of storage space in bytes allocated to subjective (node-local)
        /// storage (e.g. event history)
        pub subj_storage_bytes: u64,
    }
    impl NetworkSpecs {
        #[primary_key]
        fn pk(&self) {}
    }
}

mod impls {
    use super::tables::*;
    use psibase::services::producers::Wrapper as Producers;
    use psibase::*;

    impl BillingConfig {
        pub fn get() -> Option<Self> {
            BillingConfigTable::read().get_index_pk().get(&())
        }

        pub fn enable(enabled: bool) {
            let table = BillingConfigTable::read_write();
            let mut config =
                check_some(table.get_index_pk().get(&()), "Service not yet configured");
            config.enabled = enabled;
            table.put(&config).unwrap();
        }
    }

    use super::tables::MIN_SERVER_SPECS;

    const MAX_SERVER_SPECS: ServerSpecs = ServerSpecs {
        net_bps: u64::MAX,       // Unlimited
        storage_bytes: u64::MAX, // Unlimited
    };

    impl ServerSpecs {
        pub fn set(specs: &Self) {
            specs.validate();

            let net_bps = specs.net_bps;
            let storage_bytes = specs.storage_bytes;

            let table = ServerSpecsTable::read_write();
            let mut specs = table.get_index_pk().get(&()).unwrap_or_default();
            specs.net_bps = net_bps;
            specs.storage_bytes = storage_bytes;
            table.put(&specs).unwrap();
        }

        pub fn get() -> Option<Self> {
            ServerSpecsTable::read().get_index_pk().get(&())
        }

        fn validate(&self) {
            Self::check_range(
                self.net_bps,
                MIN_SERVER_SPECS.net_bps,
                MAX_SERVER_SPECS.net_bps,
                "Network bandwidth",
            );
            Self::check_range(
                self.storage_bytes,
                MIN_SERVER_SPECS.storage_bytes,
                MAX_SERVER_SPECS.storage_bytes,
                "Storage space",
            );
        }

        fn check_range(value: u64, min: u64, max: u64, field_name: &str) {
            check(value >= min, &format!("{} too low", field_name));
            check(value <= max, &format!("{} too high", field_name));
        }
    }

    impl NetworkVariables {
        pub fn get() -> Self {
            NetworkVariablesTable::read()
                .get_index_pk()
                .get(&())
                .unwrap_or_default()
        }
        pub fn set(vars: &Self) {
            let table = NetworkVariablesTable::read_write();

            let mut variables = table.get_index_pk().get(&()).unwrap_or_default();
            variables.block_replay_factor = vars.block_replay_factor;
            variables.per_block_sys_cpu_ns = vars.per_block_sys_cpu_ns;
            table.put(&variables).unwrap();
        }
    }

    impl NetworkSpecs {
        fn derive_net(vars: &NetworkVariables, specs: &ServerSpecs) -> u64 {
            let net_bps = specs.net_bps;
            let max_bp_peers = Producers::call().getMaxProds();
            check(
                net_bps > vars.block_replay_factor as u64 * max_bp_peers as u64,
                "Insufficient network bandwidth",
            );

            // Reduce bps to account for:
            // - increased replay speed
            let mut net_bps = net_bps / vars.block_replay_factor as u64;
            // - constant cost multiplier incurred by each network peer
            // We use max_network_peers instead of actual so that the billing doesn't change as
            // the actual peer set changes.
            net_bps = net_bps / max_bp_peers as u64;

            net_bps
        }

        fn derive_cpu(vars: &NetworkVariables) -> u64 {
            let mut cpu_ns = 1_000_000_000; // 1 s

            // Reduce cpu ns to account for:
            // - per-block system functionality
            cpu_ns = cpu_ns - vars.per_block_sys_cpu_ns;
            // - block replay factor
            cpu_ns = cpu_ns / vars.block_replay_factor as u64;

            cpu_ns
        }

        fn derive_storage(vars: &NetworkVariables, specs: &ServerSpecs) -> u64 {
            check(
                specs.storage_bytes >= vars.obj_storage_bytes,
                "Total server storage must exceed objective storage",
            );

            if let Some(network_specs) = NetworkSpecsTable::read().get_index_pk().get(&()) {
                check(
                    network_specs.obj_storage_bytes <= vars.obj_storage_bytes,
                    "Total objective storage amount cannot decrease",
                );
            }

            vars.obj_storage_bytes
        }

        pub fn set_from(specs: &ServerSpecs) {
            let vars = NetworkVariables::get();

            let net_bps = Self::derive_net(&vars, &specs);
            let cpu_ns = Self::derive_cpu(&vars);
            let obj_storage_bytes = Self::derive_storage(&vars, &specs);
            let subj_storage_bytes = specs.storage_bytes - obj_storage_bytes;

            NetworkSpecsTable::read_write()
                .put(&NetworkSpecs {
                    net_bps,
                    cpu_ns,
                    obj_storage_bytes,
                    subj_storage_bytes,
                })
                .unwrap();
        }
    }
}
