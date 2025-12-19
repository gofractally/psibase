#![allow(non_snake_case)]

mod rpc;
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
///     calling this action will enable the billing system.
///
/// > Note: typically, step 1 should be called at system boot, and therefore the network should
/// >       always at least have some server specs and derived network specs.
///
/// After each of the above steps, the billing service will be enabled, and users will be
/// required to buy resources to transact with the network. Use the other actions in this
/// service to manage server specs, network variables, and billing parameters, as needed.
#[psibase::service(name = "virtual-server", recursive = "true", tables = "tables::tables")]
mod service {
    use crate::rpc::event_types;
    use crate::tables::tables::*;
    use psibase::services::events;
    use psibase::services::{
        accounts::Wrapper as Accounts,
        cpu_limit::Wrapper as CpuLimit,
        nft::{NftHolderFlags, Wrapper as Nft},
        tokens::{BalanceFlags, Quantity, Wrapper as Tokens},
        transact::Wrapper as Transact,
    };
    use psibase::*;

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
        NetworkBandwidth::initialize();

        // Event indexes
        events::Wrapper::call().addIndex(DbId::HistoryEvent, SERVICE, method!("resources"), 0);
        events::Wrapper::call().addIndex(DbId::HistoryEvent, SERVICE, method!("subsidized"), 0);
        events::Wrapper::call().addIndex(DbId::HistoryEvent, SERVICE, method!("subsidized"), 1);
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
        Tokens::call().credit(sys, config.fee_receiver, amount, "".into());
        Tokens::call().toSub(res, for_user.to_string(), amount);

        if buyer == for_user {
            Wrapper::emit()
                .history()
                .resources(buyer, event_types::BOUGHT, amount.value);
        } else {
            Wrapper::emit()
                .history()
                .resources(for_user, event_types::RECEIVED, amount.value);

            Wrapper::emit().history().subsidized(
                buyer,
                for_user,
                amount.value,
                memo.unwrap_or("".into()),
            );
        };
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

    /// Refills the sender's resource buffer, allowing them to continue to interact with
    /// metered network functionality.
    #[action]
    fn refill_res_buf() {
        let config = BillingConfig::get_assert();
        let balance = Tokens::call().getBalance(config.res, get_sender());
        let buffer_capacity = UserSettings::get(get_sender()).buffer_capacity;

        if balance.value >= buffer_capacity {
            return;
        }

        let amount = buffer_capacity - balance.value;
        buy_res(amount.into())
    }

    fn bill(user: AccountNumber, amount: u64) {
        if let Some(config) = BillingConfig::get() {
            let res = config.res;

            let user_str = user.to_string();
            let amt: Quantity = amount.into();
            let balance = Tokens::call().getSubBal(res, user_str.clone());
            check(
                balance.is_some() && balance.unwrap() >= amt,
                &format!("{} has insufficient resource balance", &user_str),
            );

            Tokens::call().fromSub(res, user_str, amt);
        }
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
        NetworkBandwidth::set_thresholds(idle_ppm, congested_ppm);
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
        NetworkBandwidth::set_price_rates(doubling_time_sec, halving_time_sec);
    }

    #[action]
    /// Sets the number of blocks over which to compute the average network usage.
    /// This average usage is compared to the network capacity (every block) to determine
    /// the price of network bandwidth.
    fn net_blocks_avg(num_blocks: u8) {
        check(get_sender() == get_service(), "Unauthorized");
        NetworkBandwidth::set_num_blocks_to_average(num_blocks);
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

        let cost = NetworkBandwidth::consume(amount_bytes);

        if BillingConfig::get().map(|c| c.enabled).unwrap_or(false) {
            bill(user, cost);
        }

        Wrapper::emit()
            .history()
            .resources(user, event_types::CONSUMED_NET, cost);
    }

    /// Called by the system to indicate that the specified user has consumed a
    /// given amount of CPU.
    ///
    /// If billing is enabled, the user will be billed for the consumption of
    /// this resource.
    #[action]
    fn useCpuSys(user: AccountNumber, _amount_ns: u64) {
        check(
            get_sender() == Transact::SERVICE,
            "[useCpuSys] Unauthorized",
        );

        //let cost = CpuTime::consume(amount_ns);
        let cost = 1; // TODO: implement cpu pricing

        if BillingConfig::get().map(|c| c.enabled).unwrap_or(false) {
            bill(user, cost);
        }

        Wrapper::emit()
            .history()
            .resources(user, event_types::CONSUMED_CPU, cost);
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

        let net_usage = NetworkBandwidth::new_block();

        // Emit the block usage stats every 10 blocks
        if block_num % 10 == 0 {
            Wrapper::emit().history().block_summary(net_usage);
        }
    }

    /// Gets the CPU limit (in ns) for the specified account
    ///
    /// Returns None if there is no limit for the specified account
    #[action]
    fn getCpuLimit(_account: AccountNumber) -> Option<u64> {
        check(get_sender() == CpuLimit::SERVICE, "Unauthorized");

        // Todo
        //CpuTime::get_cpu_limit(account)
        Some(1_000_000_000u64) // 1 second
    }

    #[event(history)]
    fn resources(actor: AccountNumber, action: u8, amount: u64) {}

    #[event(history)]
    fn subsidized(
        purchaser: AccountNumber,
        recipient: AccountNumber,
        amount: u64,
        memo: psibase::Memo,
    ) {
    }

    #[event(history)]
    fn block_summary(net_usage_ppm: u32) {}

    #[action]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_graphql(&request, crate::rpc::Query))
            .or_else(|| serve_graphiql(&request))
    }
}

#[cfg(test)]
mod tests;
