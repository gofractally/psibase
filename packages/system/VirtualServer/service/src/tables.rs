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

        /// ID of the resource token
        pub res: TID,

        /// Account number that receives all resource billing fees
        pub fee_receiver: AccountNumber,

        /// The minimum amount of resource tokens that a user can have.
        /// (a minimum is required to ensure the user can at least afford the
        /// resource cost of acquiring more resources)
        //pub resource_min: u64,

        /// The minimum amount of resources to buffer on behalf of a user
        /// if they don't configure their own larger buffer size.
        pub min_resource_buffer: u64,

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

    #[table(name = "UserSettingsTable", index = 5)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug, SimpleObject, Clone)]
    pub struct UserSettings {
        #[primary_key]
        pub user: AccountNumber,

        /// The capacity of the resource buffer that gets filled when the user
        /// acquires resources.
        pub buffer_capacity: u64,
    }

    #[table(name = "NetworkBandwidthTable", index = 6)]
    #[derive(Serialize, Deserialize, ToSchema, Fracpack, Debug, SimpleObject, Clone)]
    pub struct NetworkBandwidth {
        pub num_blocks_to_average: u8,
        pub usage_history: Vec<u64>,
        pub current_usage_bps: u64,
        pub diff_adjust_id: u32,
    }

    impl NetworkBandwidth {
        #[primary_key]
        fn pk(&self) {}
    }
}

mod impls {
    use super::tables::*;
    use psibase::services::{
        diff_adjust::Wrapper as DiffAdjust,
        nft::Wrapper as Nft,
        producers::Wrapper as Producers,
        tokens::{TokenFlags, Wrapper as Tokens},
    };
    use psibase::*;

    const PPM: u128 = 1_000_000;
    fn ratio_to_ppm(num: u64, den: u64) -> u128 {
        (num as u128 * PPM) / (den as u128)
    }

    const LN2_PPM: u32 = 693_147; // floor(ln(2) * 1_000_000)

    // This is an approximation of the per-second rate r that satisfies:
    //
    //   (1 + r)^t = 2
    //
    // so:
    //
    //   r = 2^(1/t) - 1
    //
    // 2 is the target factor (doubling/halving), and assuming it lets me precompute
    // the ln(2) term.
    fn time_to_rate_ppm(t: u32) -> u32 {
        (LN2_PPM + t / 2) / t // round(ln(2)_ppm / t)
    }

    impl BillingConfig {
        pub fn initialize(fee_receiver: AccountNumber) {
            let table = BillingConfigTable::read_write();
            check(
                table.get_index_pk().get(&()).is_none(),
                "Billing already initialized",
            );

            let tok = Tokens::call();
            let sys = check_some(tok.getSysToken(), "System token not found");

            const DEFAULT_RESOURCE_BUFFER_SIZE: u64 = 10;
            let config = BillingConfig {
                sys: sys.id,
                res: tok.create(sys.precision, sys.max_issued_supply),
                fee_receiver,
                min_resource_buffer: DEFAULT_RESOURCE_BUFFER_SIZE
                    * 10u64.pow(sys.precision.value() as u32),
                enabled: false,
            };

            Nft::call().debit(tok.getToken(config.res).nft_id, "".into());
            tok.mint(config.res, sys.max_issued_supply, "".into());
            tok.setTokenConf(config.res, TokenFlags::UNTRANSFERABLE.index(), true);

            table.put(&config).unwrap();
        }

        pub fn get() -> Option<Self> {
            BillingConfigTable::read().get_index_pk().get(&())
        }

        pub fn get_assert() -> Self {
            check_some(
                BillingConfigTable::read().get_index_pk().get(&()),
                "Billing not yet initialized",
            )
        }

        pub fn enable(enabled: bool) {
            let table = BillingConfigTable::read_write();
            let mut config =
                check_some(table.get_index_pk().get(&()), "Billing not yet initialized");
            config.enabled = enabled;
            table.put(&config).unwrap();
        }

        pub fn get_if_enabled() -> Self {
            let table = BillingConfigTable::read();
            let config = check_some(table.get_index_pk().get(&()), "Billing not yet initialized");
            check(config.enabled, "Billing not enabled");
            config
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

        pub fn get() -> Self {
            check_some(
                NetworkSpecsTable::read().get_index_pk().get(&()),
                "Network specs not yet initialized",
            )
        }
    }

    impl UserSettings {
        pub fn get(user: AccountNumber) -> Self {
            UserSettingsTable::read()
                .get_index_pk()
                .get(&user)
                .unwrap_or_else(|| UserSettings {
                    user,
                    buffer_capacity: BillingConfig::get_assert().min_resource_buffer,
                })
        }
    }

    impl NetworkBandwidth {
        pub fn initialize() {
            const DEFAULT_NUM_BLOCKS_TO_AVERAGE: u8 = 5;

            const DEFAULT_INITIAL_DIFFICULTY: u64 = 1;
            const DEFAULT_FLOOR_DIFFICULTY: u64 = DEFAULT_INITIAL_DIFFICULTY;
            const DEFAULT_WINDOW_SECONDS: u32 = 1;
            const DEFAULT_TARGET_MIN: u32 = 45_0000; // 45% usage
            const DEFAULT_TARGET_MAX: u32 = 55_0000; // 55% usage
            const DEFAULT_INCREASE_PPM: u32 = 0_1156; // 0.1156% = 10-minute doubling rate
            const DEFAULT_DECREASE_PPM: u32 = 0_0385; // 0.0385% = 30 minute halving rate

            let diff_adjust_id = DiffAdjust::call().create(
                DEFAULT_INITIAL_DIFFICULTY,
                DEFAULT_WINDOW_SECONDS,
                DEFAULT_TARGET_MIN,
                DEFAULT_TARGET_MAX,
                DEFAULT_FLOOR_DIFFICULTY,
                DEFAULT_INCREASE_PPM,
                DEFAULT_DECREASE_PPM,
            );
            Nft::call().debit(diff_adjust_id, "".into());
            let network_bandwidth = NetworkBandwidth {
                num_blocks_to_average: DEFAULT_NUM_BLOCKS_TO_AVERAGE,
                usage_history: Vec::new(),
                current_usage_bps: 0,
                diff_adjust_id,
            };
            NetworkBandwidthTable::read_write()
                .put(&network_bandwidth)
                .unwrap();
        }

        fn get() -> Self {
            check_some(
                NetworkBandwidthTable::read().get_index_pk().get(&()),
                "Network bandwidth not initialized",
            )
        }

        pub fn set_num_blocks_to_average(num_blocks: u8) {
            let table = NetworkBandwidthTable::read_write();
            let mut bandwidth = check_some(
                table.get_index_pk().get(&()),
                "Network bandwidth not initialized",
            );
            bandwidth.num_blocks_to_average = num_blocks;
            table.put(&bandwidth).unwrap();
        }

        pub fn consume(amount_bytes: u64) -> u64 {
            let amount_bits = amount_bytes.saturating_mul(8);
            check(amount_bits < u64::MAX, "network usage overflow");

            let table = NetworkBandwidthTable::read_write();
            let mut bandwidth =
                check_some(table.get_index_pk().get(&()), "Billing not yet initialized");
            bandwidth.current_usage_bps += amount_bits;
            table.put(&bandwidth).unwrap();

            let price_per_byte = Self::price(); // Maybe this should be price per 100 bytes?
            let price = amount_bytes.saturating_mul(price_per_byte);
            check(price < u64::MAX, "network usage overflow");
            price
        }

        pub fn new_block() -> u32 {
            let table = NetworkBandwidthTable::read_write();
            let mut bandwidth = check_some(
                table.get_index_pk().get(&()),
                "Network bandwidth not initialized123",
            );

            bandwidth
                .usage_history
                .insert(0, bandwidth.current_usage_bps);
            if bandwidth.usage_history.len() > bandwidth.num_blocks_to_average as usize {
                bandwidth.usage_history.pop();
            }

            let avg: u64 = if bandwidth.usage_history.is_empty() {
                0
            } else {
                bandwidth.usage_history.iter().sum::<u64>() / bandwidth.usage_history.len() as u64
            };

            let net_bps_capacity = NetworkSpecs::get().net_bps;
            let mut ppm = ratio_to_ppm(avg, net_bps_capacity);

            // Clamp to 10x "full capacity" If we are that far over our bandwidth limit, I think we can just
            // lose the real multiple. (needs to be clamped somewhere because it can only be u32
            // to work with the diffadjust api)
            ppm = ppm.min(10_000_000);
            let ppm = ppm as u32;

            // The increment amount is actually the ratio of the average usage to the total available
            DiffAdjust::call().increment(bandwidth.diff_adjust_id, ppm);

            bandwidth.current_usage_bps = 0;
            table.put(&bandwidth).unwrap();

            ppm
        }

        pub fn price() -> u64 {
            DiffAdjust::call().get_diff(Self::get().diff_adjust_id)
        }

        pub fn set_thresholds(idle_ppm: u32, congested_ppm: u32) {
            DiffAdjust::call().set_targets(Self::get().diff_adjust_id, idle_ppm, congested_ppm);
        }

        pub fn set_price_rates(doubling_time_sec: u32, halving_time_sec: u32) {
            check(
                doubling_time_sec > 0,
                "doubling time must be greater than 0",
            );
            check(halving_time_sec > 0, "halving time must be greater than 0");
            let increase_ppm = time_to_rate_ppm(doubling_time_sec);
            let decrease_ppm = time_to_rate_ppm(halving_time_sec);
            DiffAdjust::call().set_percent(Self::get().diff_adjust_id, increase_ppm, decrease_ppm);
        }

        // pub fn set_price_rates(increase_ppm: u32, decrease_ppm: u32) {
        //     DiffAdjust::call().set_percent(Self::get().diff_adjust_id, increase_ppm, decrease_ppm);
        // }
    }
}
