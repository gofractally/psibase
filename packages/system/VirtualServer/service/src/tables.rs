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
            InitTable::read_write().put(&InitRow {}).unwrap();
        }

        pub fn is_init() -> bool {
            InitTable::read().get_index_pk().get(&()).is_some()
        }

        pub fn check_init() {
            check(InitRow::is_init(), "service not initialized");
        }
    }

    #[table(name = "BillingConfigTable", index = 1)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug, SimpleObject, Clone)]
    #[serde(rename_all = "camelCase")]
    pub struct BillingConfig {
        /// ID of the system token used for resource billing
        pub sys: TID,

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
        /// Amount of network bandwidth capacity per second in bits per second
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

    /// Settings related to the automatic management of an account resource buffer.
    /// If an account has not configured these settings, a default configuration will be used.
    #[table(name = "UserSettingsTable", index = 5)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug, SimpleObject, Clone)]
    pub struct UserSettings {
        #[primary_key]
        pub user: AccountNumber,

        /// The percentage at which client-side tooling should attempt to refill the user's
        /// resource buffer. A value of 0 means that the client should not auto refill.
        pub auto_fill_threshold_percent: u8,

        /// The capacity of the resource buffer that gets filled when the user
        /// acquires resources.
        pub buffer_capacity: u64,
    }

    /// Parameters related to the automatic management of an account resource buffer.
    #[derive(Fracpack, ToSchema, Serialize, Deserialize, Debug, Clone)]
    pub struct BufferConfig {
        /// A threshold (specified in integer percentage values) at or below which the client should
        /// attempt to automatically refill the account's resource buffer. A threshold of 0 means
        /// that the client should not attempt to automatically manage the account's buffer.
        pub threshold_percent: u8,

        /// The total capacity of the account's buffer used to reserve system tokens.
        pub capacity: u64,
    }

    #[table(name = "NetPricingTable", index = 6)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug, SimpleObject, Clone)]
    #[graphql(complex)]
    pub struct NetPricing {
        /// The number of blocks over which to compute the average usage
        pub num_blocks_to_average: u8,

        #[graphql(skip)]
        /// The actual history of network bandwidth usage over the last
        /// `num_blocks_to_average` blocks
        pub usage_history: Vec<u64>,

        #[graphql(skip)]
        /// The network bandwidth usage in bits per second for the current block
        pub current_usage_bps: u64,

        #[graphql(skip)]
        /// The ID Of the diff adjust object used to calculate price
        pub diff_adjust_id: u32,

        /// The approximate amount of time it takes to double the price when congested
        pub doubling_time_sec: u32,

        /// The approximate amount of time it takes to halve the price when idle
        pub halving_time_sec: u32,

        /// This is some number of bits that represents the smallest unit of billable
        /// network bandwidth. Consumed network bandwidth is rounded up to the nearest
        /// billable unit.
        pub billable_unit: u64,
    }

    impl NetPricing {
        #[primary_key]
        fn pk(&self) {}
    }

    #[table(name = "CpuPricingTable", index = 7)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug, SimpleObject, Clone)]
    #[graphql(complex)]
    pub struct CpuPricing {
        /// The number of blocks over which to compute the average usage
        pub num_blocks_to_average: u8,

        #[graphql(skip)]
        /// The actual history of CPU time usage over the last
        /// `num_blocks_to_average` blocks
        pub usage_history: Vec<u64>,

        #[graphql(skip)]
        /// The CPU time usage in nanoseconds for the current block
        pub current_usage_ns: u64,

        #[graphql(skip)]
        /// The ID Of the diff adjust object used to calculate price
        pub diff_adjust_id: u32,

        /// The approximate amount of time it takes to double the price when congested
        pub doubling_time_sec: u32,

        /// The approximate amount of time it takes to halve the price when idle
        pub halving_time_sec: u32,

        /// This is some number of nanoseconds that represents the smallest unit of
        /// billable CPU time. Consumed CPU time is rounded up to the nearest billable unit.
        pub billable_unit: u64,
    }

    impl CpuPricing {
        #[primary_key]
        fn pk(&self) {}
    }
}

mod billing_config;
mod cpu_pricing;
mod net_pricing;
mod network_specs;
mod network_variables;
mod pricing_common;
mod server_specs;
mod user_settings;

pub use user_settings::DEFAULT_AUTO_FILL_THRESHOLD_PERCENT;

pub use pricing_common::*;
