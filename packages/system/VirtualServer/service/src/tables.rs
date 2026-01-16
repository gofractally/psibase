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
    #[graphql(complex)]
    #[serde(rename_all = "camelCase")]
    pub struct BillingConfig {
        /// ID of the system token used for resource billing
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

    #[table(name = "UserSettingsTable", index = 5)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug, SimpleObject, Clone)]
    pub struct UserSettings {
        #[primary_key]
        pub user: AccountNumber,

        /// The percentage at which client-side tooling should attempt to refill the user's
        /// resource buffer. A value of 0 means that the client should not auto refill.
        ///
        /// Default: 20
        pub auto_fill_threshold_percent: u8,

        /// The capacity of the resource buffer that gets filled when the user
        /// acquires resources.
        ///
        /// If this is None, a default buffer capacity is used.
        pub buffer_capacity: Option<u64>,
    }

    /// The reserve is a table that holds a u64 representing additional resources that are available
    /// to the user outside of the normal resource balance. Used to ensure that the just-in-time billing
    /// (e.g. objective data writes, events) does not exceed the amount of resources that must be
    /// available to pay for the CPU cost of the executing transaction.
    //
    // Design justification:
    //
    // The reserve cannot be dynamically constructed, because then writing to it would require a db
    //   write if it didn't yet exist, and the point of the reserve is that it should happen before
    //   any writes are allowed so that we know how many resources the user has available for writes.
    //   user has available for writes.
    //
    // Furthermore, we can't use the tokens service subaccounts for reserves, because the API requires
    //   that we would know the token ID for which to construct the zero-balance. And reserves need to
    //   be created for all accounts, including those that are created before a resource token exists.
    //
    // Therefore, the Accounts service will initialize every new user with this virtual server service,
    //   which constructs the account's reserve (with a balance of zero) in its own tables. This is
    //  therefore paid for by the account creator and is part of account initialization, so subsequent
    //  writes to the reserve do not cost additional storage resources (storage delta always = 0).
    #[table(name = "UserReserveTable", index = 6)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug, SimpleObject, Clone)]
    pub struct UserReserve {
        #[primary_key]
        pub user: AccountNumber,
        pub reserve: u64,
    }

    #[table(name = "NetPricingTable", index = 7)]
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

    #[table(name = "CpuPricingTable", index = 8)]
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
mod user_reserve;
mod user_settings;

pub use pricing_common::*;
