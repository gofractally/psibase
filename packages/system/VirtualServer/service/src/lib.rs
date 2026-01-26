#![allow(non_snake_case)]

pub mod rpc;
pub mod tables;

/// Virtual Server Service
///
/// This service defines a "virtual server" that represents the "server" with which
/// a user interacts when they connect to any full node on the network.
///
/// This service distinguishes between the specs of the network itself, and
/// the specs of an individual node that runs the virtual server. The actual node
/// specs must meet or exceed the specs defined for the virtual server. And the
/// derived network specs will always be less than the virtual server specs to account
/// for various overheads (e.g. from running a distributed network, desired replay
/// speed, etc).
///
/// This service also defines a billing system that allows for the network to meter
/// the consumption of resources by users. A user must "buy" resources from this service
/// by sending in a network token, which is exchanged 1:1 for an internal resource token.
/// The resource tokens are then exchanged in real-time for the internal tokens that
/// represent consumption of individual network resources (CPU, network bandwidth, storage,
/// etc).
///
/// Note that this service is unopinionated about how the user gets the system tokens with
/// which to pay for the resources. This allows for networks wherein users' system token
/// balances are distributed manually by a custodian, as well as networks wherein the system
/// token is distributed by other means (e.g. proof of work, proof of stake, etc.).
///
/// To use:
/// 1 - Call `init`: Initialize the service. This will derive the network specs using the
///     default server specs.
/// 2 - Call `init_billing`: Initializes the billing system. To call this, the system token
///     must have already been set in the `Tokens` service. The specified `fee_receiver` will
///     receive all of the system token fees paid for resources by users.
/// 3 - Call `enable_billing`: When ready (when existing users have accumulated system tokens),
///     calling this action will enable the billing system. To call this, the caller must have
///     already filled their resource buffer because the action to enable billing is itself billed.
///
/// > Note: typically, step 1 should be called at system boot, and therefore the network should
/// >       always at least have some server specs and derived network specs.
///
/// After each of the above steps, the billing service will be enabled, and users will be
/// required to buy resources to transact with the network. Use the other actions in this
/// service to manage server specs, network variables, and billing parameters, as needed.
#[psibase::service(name = "virtual-server", recursive = "true", tables = "tables::tables")]
mod service {
    use crate::rpc::resources;
    use crate::tables::tables::*;
    use psibase::services::events;
    use psibase::services::{
        accounts::Wrapper as Accounts,
        cpu_limit::Wrapper as CpuLimit,
        nft::{NftHolderFlags, Wrapper as Nft},
        tokens::{BalanceFlags, Quantity, Wrapper as Tokens},
        transact::Wrapper as Transact,
    };
    use psibase::{abort_message, *};
    use std::cmp::min;

    // A small amount of CPU leeway given to transactions
    const CPU_LEEWAY: u64 = 1_000_000u64; // 1 ms

    #[action]
    fn init() {
        if InitRow::is_init() {
            return;
        }

        InitRow::init();

        Nft::call().setUserConf(NftHolderFlags::MANUAL_DEBIT.index(), true);
        Tokens::call().setUserConf(BalanceFlags::MANUAL_DEBIT.index(), true);
        Wrapper::call().set_specs(MIN_SERVER_SPECS);
        Transact::call().resMonitoring(true);

        // Initialize network resource consumption tracking
        NetPricing::initialize();
        CpuPricing::initialize();

        // Event indexes
        events::Wrapper::call().addIndex(DbId::HistoryEvent, SERVICE, method!("consumed"), 0);
        events::Wrapper::call().addIndex(DbId::HistoryEvent, SERVICE, method!("subsidized"), 0);
        events::Wrapper::call().addIndex(DbId::HistoryEvent, SERVICE, method!("subsidized"), 1);
        events::Wrapper::call().addIndex(DbId::HistoryEvent, SERVICE, method!("block_summary"), 0);

        // TODO: Iterate over the system service tables and aggregate code rows as pre-allocated objective disk space
        // (the accounts service init already does such iterating, use as reference.)
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        InitRow::check_init();
    }

    /// Initializes the billing system
    ///
    /// If no specs are provided, some default specs are used that define a server
    ///   with minimal specs.
    ///
    /// After calling this action, the billing system is NOT yet enabled. The
    /// `enable_billing` action must be called explicitly to enable user billing.
    #[action]
    fn init_billing(fee_receiver: AccountNumber) {
        check(get_sender() == get_service(), "Unauthorized");
        check(Accounts::call().exists(fee_receiver), "Fee_receiver DNE");

        BillingConfig::initialize(fee_receiver);
    }

    /// Get the account that receives all resource billing fees
    #[action]
    fn get_fee_receiver() -> Option<AccountNumber> {
        BillingConfig::get().map(|c| c.fee_receiver)
    }

    /// Set the virtual server specs
    ///
    /// These are effectively the minimum specs that any node that participates
    /// in the network must have available.
    #[action]
    fn set_specs(specs: ServerSpecs) {
        check(get_sender() == get_service(), "Unauthorized");

        ServerSpecs::set(&specs);
        NetworkSpecs::set_from(&specs);
    }

    /// These variables change how the network specs are derived from the server
    /// specs.
    ///
    /// The "network specs" are the specifications of the server as perceived by
    /// a user of the network, which is not the same as the specs needed by each
    /// of the actual nodes. Only a subset of the nodes resources are available for
    /// use by users of the network to account for other overhead and system
    /// functionality.
    #[action]
    fn set_network_variables(variables: NetworkVariables) {
        check(get_sender() == get_service(), "Unauthorized");

        NetworkVariables::set(&variables);
    }

    /// Enable or disable the billing system
    ///
    /// If billing is disabled, resource consumption will still be tracked, but the resources will
    /// not be automatically metered by the network. This is insecure and allows users to abuse
    /// the network by consuming all of the network's resources.
    #[action]
    fn enable_billing(enabled: bool) {
        check(get_sender() == get_service(), "Unauthorized");

        BillingConfig::enable(enabled);
    }

    /// Used to acquire resource tokens for a user.
    ///
    /// The resource tokens are consumed when interacting with metered network functionality.
    ///
    /// The sender must have already credited the system token to this service to pay
    /// for the specified amount of resource tokens. The exchange rate is always 1:1.
    ///
    /// # Arguments
    /// * `amount`   - The amount of resource tokens to buy
    /// * `for_user` - The user to buy the resource tokens for
    /// * `memo`     - A memo for the purchase, only used if the sender is not the resource recipient
    #[action]
    fn buy_res_for(amount: Quantity, for_user: AccountNumber, memo: Option<psibase::Memo>) {
        let config = check_some(BillingConfig::get(), "Billing not initialized");

        let sys = config.sys;
        let res = config.res;

        let buyer = get_sender();

        Tokens::call().debit(sys, buyer, amount, "".into());
        Tokens::call().toSub(res, for_user.to_string(), amount);

        if buyer != for_user {
            // No need for a subsidy event if user == buyer because it's not a subsidy and the purchase
            // can be reconstructed from the user's own token `balChanged` event history.
            Wrapper::emit().history().subsidized(
                buyer,
                for_user,
                amount.value,
                memo.unwrap_or("".into()),
            );
        }
    }

    /// Used to acquire resource tokens for the sender
    ///
    /// The resource tokens are consumed when interacting with metered network functionality.
    ///
    /// The sender must have already credited the system token to this service to pay
    /// for the specified amount of resource tokens. The exchange rate is always 1:1.
    #[action]
    fn buy_res(amount: Quantity) {
        buy_res_for(amount, get_sender(), None);
    }

    /// Allows the sender to request client-side tooling to automatically attempt to
    /// refill their resource buffer when it is at or below the threshold (specified
    /// in integer percentage values).
    ///
    /// A threshold of 0 means that the client should not attempt to refill the
    /// resource buffer.
    #[action]
    fn conf_auto_fill(threshold_percent: u8) {
        UserSettings::get(get_sender()).set_auto_fill(threshold_percent);
    }

    /// Allows the sender to specify the capacity of their resource buffer. The larger the
    /// resource buffer, the less often the sender will need to refill it.
    #[action]
    fn conf_buffer(capacity: u64) {
        UserSettings::get(get_sender()).set_capacity(capacity);
    }

    fn bill(user: AccountNumber, amount: u64) {
        if amount == 0 {
            return;
        }

        if let Some(config) = BillingConfig::get() {
            let res = config.res;

            let balance = UserSettings::get_resource_balance(user);
            let amt = Quantity::new(amount);

            if balance < amt {
                let err = format!("{} has insufficient resource balance", user);
                abort_message(&err);
            }

            Tokens::call().fromSub(res, user.to_string(), amt);
            Tokens::call().credit(config.sys, config.fee_receiver, amt, "".into());
        }
    }

    /// Set the network bandwidth pricing thresholds
    ///
    /// Configures the idle and congested thresholds used by the pricing algorithm
    /// for network bandwidth billing. These thresholds are ppm values representing
    /// the fraction of total available bandwidth (e.g. 45_0000 = 45%, 55_0000 = 55%).
    ///
    /// Below the idle threshold, the price of network bandwidth will decrease.
    /// Above the congested threshold, the price of network bandwidth will increase.
    ///
    /// # Arguments
    /// * `idle_ppm` - Threshold below which the network is considered idle (ppm)
    /// * `congested_ppm` - Threshold above which the network is considered congested (ppm)
    #[action]
    fn net_thresholds(idle_ppm: u32, congested_ppm: u32) {
        check(get_sender() == get_service(), "Unauthorized");
        NetPricing::set_thresholds(idle_ppm, congested_ppm);
    }

    /// Set the network bandwidth price change rates
    ///
    /// Configures the rate at which the network bandwidth price increases when
    /// congested and decreases when idle.
    ///
    /// # Arguments
    /// * `doubling_time_sec` - Time it takes to double the price when congested
    /// * `halving_time_sec` - Time it takes to halve the price when idle
    #[action]
    fn net_rates(doubling_time_sec: u32, halving_time_sec: u32) {
        check(get_sender() == get_service(), "Unauthorized");
        NetPricing::set_change_rates(doubling_time_sec, halving_time_sec);
    }

    /// Sets the number of blocks over which to compute the average network usage.
    /// This average usage is compared to the network capacity (every block) to determine
    /// the price of network bandwidth.
    #[action]
    fn net_blocks_avg(num_blocks: u8) {
        check(get_sender() == get_service(), "Unauthorized");
        check(num_blocks > 0, "Number of blocks must be greater than 0");
        NetPricing::set_num_blocks_to_average(num_blocks);
    }

    /// Sets the size of the billable unit of network bandwidth.
    ///
    /// This unit is also the minimum amount billed for bandwidth in a single transaction.
    #[action]
    fn net_min_unit(bits: u64) {
        check(get_sender() == get_service(), "Unauthorized");
        NetPricing::set_billable_unit(bits);
    }

    /// Set the CPU pricing thresholds
    ///
    /// Configures the idle and congested thresholds used by the pricing algorithm
    /// for CPU billing. These thresholds are ppm values representing
    /// the fraction of total available CPU (e.g. 45_0000 = 45%, 55_0000 = 55%).
    ///
    /// Below the idle threshold, the price of CPU will decrease.
    /// Above the congested threshold, the price of CPU will increase.
    ///
    /// # Arguments
    /// * `idle_ppm` - Threshold below which the network is considered idle (ppm)
    /// * `congested_ppm` - Threshold above which the network is considered congested (ppm)
    #[action]
    fn cpu_thresholds(idle_ppm: u32, congested_ppm: u32) {
        check(get_sender() == get_service(), "Unauthorized");
        CpuPricing::set_thresholds(idle_ppm, congested_ppm);
    }

    /// Set the CPU price change rates
    ///
    /// Configures the rate at which the CPU price increases when
    /// congested and decreases when idle.
    ///
    /// # Arguments
    /// * `doubling_time_sec` - Time it takes to double the price when congested
    /// * `halving_time_sec` - Time it takes to halve the price when idle
    #[action]
    fn cpu_rates(doubling_time_sec: u32, halving_time_sec: u32) {
        check(get_sender() == get_service(), "Unauthorized");
        CpuPricing::set_change_rates(doubling_time_sec, halving_time_sec);
    }

    /// Sets the number of blocks over which to compute the average CPU usage.
    /// This average usage is compared to the network capacity (every block) to determine
    /// the price of CPU.
    #[action]
    fn cpu_blocks_avg(num_blocks: u8) {
        check(get_sender() == get_service(), "Unauthorized");
        check(num_blocks > 0, "Number of blocks must be greater than 0");
        CpuPricing::set_num_blocks_to_average(num_blocks);
    }

    /// Sets the size of the billable unit of CPU time.
    ///
    /// This unit is also the minimum amount billed for CPU in a single transaction.
    #[action]
    fn cpu_min_unit(ns: u64) {
        check(get_sender() == get_service(), "Unauthorized");
        CpuPricing::set_billable_unit(ns);
    }

    /// Called by the system to indicate that the specified user has consumed a
    /// given amount of network bandwidth.
    ///
    /// If billing is enabled, the user will be billed for the consumption of
    /// this resource.
    #[action]
    fn useNetSys(user: AccountNumber, amount_bytes: u64) {
        check(
            get_sender() == Transact::SERVICE,
            "[useNetSys] Unauthorized",
        );

        let mut cost = NetPricing::consume(amount_bytes);

        if !isBillingEnabled() {
            cost = 0
        }
        bill(user, cost);

        Wrapper::emit()
            .history()
            .consumed(user, resources::NET, amount_bytes, cost);
    }

    fn isBillingEnabled() -> bool {
        BillingConfig::get().map(|c| c.enabled).unwrap_or(false)
    }

    /// Called by the system to indicate that the specified user has consumed a
    /// given amount of CPU.
    ///
    /// If billing is enabled, the user will be billed for the consumption of
    /// this resource.
    #[action]
    fn useCpuSys(user: AccountNumber, amount_ns: u64) {
        check(
            get_sender() == Transact::SERVICE,
            "[useCpuSys] Unauthorized",
        );

        let amount_ns = amount_ns.saturating_sub(CPU_LEEWAY);
        let mut cost = CpuPricing::consume(amount_ns);

        if !isBillingEnabled() {
            cost = 0
        }
        bill(user, cost);

        Wrapper::emit()
            .history()
            .consumed(user, resources::CPU, amount_ns, cost);
    }

    #[action]
    fn get_resources(user: AccountNumber) -> Quantity {
        let config = BillingConfig::get_assert();

        Tokens::call()
            .getSubBal(config.res, user.to_string())
            .unwrap_or(0.into())
    }

    #[action]
    fn notifyBlock(block_num: BlockNum) {
        check(get_sender() == Transact::SERVICE, "Unauthorized");

        let net_usage = NetPricing::new_block();
        let cpu_usage = CpuPricing::new_block();

        // Emit the block usage stats every 10 blocks
        if block_num % 10 == 0 {
            Wrapper::emit()
                .history()
                .block_summary(block_num, net_usage, cpu_usage);
        }
    }

    // Gets the CPU limit (in ns) for the specified account
    //
    // Returns None if there is no limit for the specified account
    fn get_cpu_limit(account: AccountNumber) -> Option<u64> {
        if !isBillingEnabled() {
            return None;
        }

        let cpu_pricing = CpuPricing::get_assert();
        let res_balance = UserSettings::get_resource_balance(account).value;

        let price_per_unit = cpu_pricing.price();
        let ns_per_unit = cpu_pricing.billable_unit;

        let full_block_units = NetworkSpecs::get_assert().cpu_ns / ns_per_unit; // rounded down
        let affordable_units = res_balance / price_per_unit;
        let limit_units = min(full_block_units, affordable_units);
        let mut limit_ns = limit_units * ns_per_unit;

        // To add some leeway, we simply bump the limit by more CPU than the limit allows,
        //   and before billing, we subtract the leeway from the reported consumed amount.
        limit_ns = limit_ns.saturating_add(CPU_LEEWAY);
        limit_ns = min(limit_ns, NetworkSpecs::get_assert().cpu_ns);

        Some(limit_ns)
    }

    /// This actions sets the CPU limit for the specified account.
    /// If the current tx exceeds the limit (ns), then the tx will timeout and fail.
    #[action]
    fn setCpuLimit(account: AccountNumber) {
        check(get_sender() == Transact::SERVICE, "Unauthorized");
        CpuLimit::rpc().setCpuLimit(get_cpu_limit(account));
    }

    #[action]
    fn serveSys(
        request: HttpRequest,
        _socket: Option<i32>,
        user: Option<AccountNumber>,
    ) -> Option<HttpReply> {
        check(
            get_sender() == AccountNumber::from("http-server"),
            "permission denied: tokens::serveSys only callable by 'http-server'",
        );

        None.or_else(|| serve_graphql(&request, crate::rpc::Query { user }))
            .or_else(|| serve_graphiql(&request))
    }

    #[event(history)]
    fn consumed(account: AccountNumber, resource: u8, amount: u64, cost: u64) {}

    #[event(history)]
    fn subsidized(
        purchaser: AccountNumber,
        recipient: AccountNumber,
        amount: u64,
        memo: psibase::Memo,
    ) {
    }

    #[event(history)]
    fn block_summary(block_num: BlockNum, net_usage_ppm: u32, cpu_usage_ppm: u32) {}
}

#[cfg(test)]
mod tests;
