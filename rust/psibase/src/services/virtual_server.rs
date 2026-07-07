use crate::{Fracpack, ToSchema};
use async_graphql::SimpleObject;
use serde::{Deserialize, Serialize};

/// The specs of the virtual server and the specs required by each node
/// and are used to configure the network specs.
#[derive(Debug, Clone, Serialize, Deserialize, Fracpack, ToSchema, SimpleObject)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct ServerSpecs {
    /// Amount of bandwidth capacity per second per server
    pub net_bps: u64,
    /// Amount of storage space in bytes per server
    pub storage_bytes: u64,
}

/// Variables that are used to derive the specs of the network from the server specs.
#[derive(Debug, Clone, Serialize, Deserialize, Fracpack, ToSchema, SimpleObject)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct NetworkVariables {
    /// How much faster a node replays blocks compared to the live network
    pub block_replay_factor: u8,
    /// Amount of compute nanoseconds per second consumed by system functionality
    /// that is executed on each block (`on_block` callbacks, native consensus, etc.)
    pub per_block_sys_cpu_ns: u64,
    /// Amount of storage space in bytes allocated to objective state
    pub obj_storage_bytes: u64,
    /// Amount of storage space in bytes allocated to subjective (node-local) state
    pub subj_storage_bytes: u64,
}

/// Parameters related to the automatic management of an account resource buffer.
#[derive(Debug, Clone, Serialize, Deserialize, Fracpack, ToSchema, SimpleObject)]
#[fracpack(fracpack_mod = "fracpack")]
pub struct BufferConfig {
    /// A threshold (specified in integer percentage values) at or below which the client should
    /// attempt to automatically refill the account's resource buffer. A threshold of 0 means
    /// that the client should not attempt to automatically manage the account's buffer.
    pub threshold_percent: u8,
    /// The total capacity of the account's buffer used to reserve system tokens.
    pub capacity: u64,
}

/// # Virtual Server Service
///
/// This service defines a "virtual server" that represents the subset of a real server that
/// a node operator dedicates to running their network node. A user then interacts with one
/// or more virtual servers that are peered together to form a network. The network has
/// effective specifications that are derived from (and necessarily lower than) the virtual
/// server specs. The difference in specs comes from various overhead costs incurred by the
/// management of the network.
///
/// Example diagram:
///
/// .------------------------.  .------------------------.  .------------------------.
/// |     Actual Server 1    |  |     Actual Server 2    |  |     Actual Server 3    |
/// |                        |  |                        |  |                        |
/// |    100 Gbps network    |  |    50 Gbps network     |  |    100 Gbps network    |
/// |       2 TB disk        |  |       1 TB disk        |  |      300 GB disk       |
/// |                        |  |                        |  |                        |
/// | .--------------------. |  | .--------------------. |  | .--------------------. |
/// | |  Virtual Server 1  | |  | |  Virtual Server 2  | |  | |  Virtual Server 3  | |
/// | |  10 Gbps network   | |  | |  10 Gbps network   | |  | |  10 Gbps network   | |
/// | |    100 GB disk     | |  | |    100 GB disk     | |  | |    100 GB disk     | |
/// | '---------+----------' |  | '---------+----------' |  | '---------+----------' |
/// '-----------|------------'  '-----------|------------'  '-----------|------------'
///             |                           |                           |
///             |                           V                           |
///             |        .--------------------------------------.       |
///             |        |               Network                |       |
///             +------->|  .--------------------------------.  |<------+
///                      |  |            1 Gbps              |  |
///                      |  |    50 GB replicated storage    |  |
///                      |  |    50 GB node-local storage    |  |
///                      |  '-------------------------------'   |
///                      '-------------------^------------------'
///                                          |
///                                          v
///                                    .-----------.
///                                    |   User    |
///                                    '-----------'
///
/// This service also manages monitoring all of the network's resource consumption, and exposes
/// an interface that can be used to tune a billing system for rate-limiting per-account resource
/// consumption. Users can send system tokens into a "reserve" that can be subsequently redeemed for
/// resource consumption.
///
/// As physical resources (CPU, disk space, network bandwidth, etc.) are consumed, the
/// real-time price of the resource is billed to the user's reserved balance. Reserved system
/// tokens do not equate to any specific resource amounts, since it's dependent upon the spot
/// price of the consumed resource at the time of consumption.
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
/// 3 - Call `enable_billing(true)`: When ready, calling this action enables the
///     billing system. The caller must have already filled their resource buffer because
///     this action is itself billed.
///
/// > Note: typically, step 1 should be called at system boot, and therefore the network should
/// >       always at least have some server specs and derived network specs.
///
/// After each of the above steps, the billing service will be enabled, and users will be
/// required to buy resources to transact with the network. Use the other actions in this
/// service to manage server specs, network variables, and billing parameters, as needed.
///
/// ## Curve under-collateralization
///
/// Capacity limited resources are managed via a constant-product curve that reports the quantity
/// of reserve tokens required to be held as collateral for the current utilization levels of the
/// resource.
///
/// This service attempts to balance the required collateral as reported by the state of the curve
/// with the actual collateral as measured by the relay subaccount token balance. The curve for a
/// capacity-limited resource can be undercollateralized in certain well-defined scenarios (e.g.
/// consumption before billing is enabled).
///
/// An undercollateralized curve is recollateralized over time using the fees that would otherwise
/// be sent to the fee receiver.
///
/// Example disk recollateralization flow diagram (simplified for clarity) for a transaction that
/// frees bytes:
///
/// ```text
///             .---------------.
///            (   free bytes    )
///             '-------+-------'
///                     |
///                     v
///          +--------------------------+
///          | Reduces curve shortfall  |
///          +-----------+--------------+
///                      |
///                      v
///                 .----------.
///                /            \
///       No      /   curve has  \     Yes
///     .--------(   collateral?  )--------.
///     |         \              /          |
///     |          \            /           |
///     v           '----------'            v
///  .-----.                      +--------------------+
/// (  End  )                     |  Calc user refund  |
///  '-----'                      +---------+----------+
///                                         |
///                                         v
///                               +----------------------+
///                               | Take fee from refund |
///                               +---------+------------+
///                                         |
///                                         v
///                               +--------------------+
///                               |  Send user refund  |
///                               +---------+----------+
///                                         |
///                                         v
///                                .-----------------.
///                               /                   \
///                   yes        /    Curve under-     \        no
///                 .-----------(   collateralized?     )-----------.
///                 |            \                     /            |
///                 v             '-------------------'             v
///       +--------------------+                        +--------------------------+
///       |  Add fee to relay  |                        | Send fee to fee receiver |
///       +--------------------+                        +--------------------------+
/// ```
#[crate::service(name = "vserver", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use super::{BufferConfig, NetworkVariables, ServerSpecs};
    use crate::services::tokens::Quantity;
    use crate::*;

    #[action]
    fn init() {
        unimplemented!()
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        unimplemented!()
    }

    /// Initializes the billing system
    ///
    /// The `fee_receiver` account will receive all resource billing fees.
    ///
    /// After calling this action, the billing system is NOT yet enabled. The
    /// `enable_billing` action must be called explicitly to enable user billing.
    #[action]
    fn init_billing(fee_receiver: AccountNumber) {
        unimplemented!()
    }

    /// Get the account that receives all resource billing fees
    #[action]
    fn get_fee_receiver() -> Option<AccountNumber> {
        unimplemented!()
    }

    /// Set the virtual server specs
    ///
    /// These are effectively the minimum specs that any node that participates
    /// in the network must have available.
    #[action]
    fn set_specs(specs: ServerSpecs) {
        unimplemented!()
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
        unimplemented!()
    }

    /// Enable or disable the billing system
    ///
    /// If billing is disabled, resource consumption will still be tracked, but the resources will
    /// not be automatically metered by the network. This is insecure and allows users to abuse
    /// the network by consuming all of the network's resources.
    #[action]
    fn enable_billing(enabled: bool) {
        unimplemented!()
    }

    /// Returns whether the billing system has been enabled
    #[action]
    fn is_billing_enabled() -> bool {
        unimplemented!()
    }

    /// Reserves system tokens for future resource consumption by the specified user.
    ///
    /// The reserve is consumed when interacting with metered network functionality.
    ///
    /// The sender must have already credited the system tokens to this service.
    ///
    /// # Arguments
    /// * `amount`   - The amount of systems tokens to reserve
    /// * `for_user` - The user to reserve the system tokens for
    /// * `memo`     - An optional memo to attach to the reservation, only used if the sender is not
    ///                the resource recipient
    #[action]
    fn buy_res_for(amount: Quantity, for_user: AccountNumber, memo: Option<crate::Memo>) {
        unimplemented!()
    }

    /// Reserves system tokens for future resource consumption by the specified sub-account.
    ///
    /// The sender must have already credited the system tokens to this service.
    ///
    /// The sender of this action owns the resources in the specified subaccount and is therefore able to specify
    /// it as the billable account for a given transaction at any time.
    ///
    /// # Arguments
    /// * `amount`      - The amount of systems tokens to reserve
    /// * `sub_account` - The sub-account to reserve the system tokens for
    #[action]
    fn buy_res_sub(amount: Quantity, sub_account: String) {
        unimplemented!()
    }

    /// Deletes the resource subaccount, returning the resources back to the caller's primary
    /// resource balance.
    #[action]
    fn del_res_sub(sub_account: String) {
        unimplemented!()
    }

    /// Reserves system tokens for future resource consumption by the sender
    ///
    /// The reserve is consumed when interacting with metered network functionality.
    ///
    /// The sender must have already credited the system tokens to this service.
    #[action]
    fn buy_res(amount: Quantity) {
        unimplemented!()
    }

    /// Allows the sender to specify one of their sub-accounts as the billable account for
    /// the current transaction.
    ///
    /// This will only succeed if the sender has already been set by `Transact` to be the
    /// billable account.
    #[action]
    fn bill_to_sub(sub_account: String) {
        unimplemented!()
    }

    /// Allows the sender to manage the behavior of client-side tooling with respect to the
    /// automatic management of the sender's resource buffer.
    ///
    /// If `config` is None, the account will use a default configuration
    #[action]
    fn conf_buffer(config: Option<BufferConfig>) {
        unimplemented!()
    }

    /// Returns the current cost of a typically sized resource buffer
    #[action]
    fn std_buffer_cost() -> Quantity {
        unimplemented!()
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
        unimplemented!()
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
        unimplemented!()
    }

    /// Sets the number of blocks over which to compute the average network usage.
    /// This average usage is compared to the network capacity (every block) to determine
    /// the price of network bandwidth.
    #[action]
    fn net_blocks_avg(num_blocks: u8) {
        unimplemented!()
    }

    /// Sets the size of the billable unit of network bandwidth.
    ///
    /// This unit is also the minimum amount billed for bandwidth in a single transaction.
    #[action]
    fn net_min_unit(bits: u64) {
        unimplemented!()
    }

    /// Returns the current cost (in system tokens) of consuming the specified amount of network
    /// bandwidth
    #[action]
    fn get_net_cost(bytes: u64) -> Quantity {
        unimplemented!()
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
        unimplemented!()
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
        unimplemented!()
    }

    /// Sets the number of blocks over which to compute the average CPU usage.
    /// This average usage is compared to the network capacity (every block) to determine
    /// the price of CPU.
    #[action]
    fn cpu_blocks_avg(num_blocks: u8) {
        unimplemented!()
    }

    /// Sets the size of the billable unit of CPU time.
    ///
    /// This unit is also the minimum amount billed for CPU in a single transaction.
    #[action]
    fn cpu_min_unit(ns: u64) {
        unimplemented!()
    }

    /// Returns the current cost (in system tokens) of consuming the specified amount of
    /// CPU time
    #[action]
    fn get_cpu_cost(ns: u64) -> Quantity {
        unimplemented!()
    }

    /// Reduce the disk-pricing reserve budget by `delta_supply`.
    ///
    /// The reserve budget caps the system tokens that may be sold into the disk-pricing
    /// relay. Reducing it lowers the spot price of disk.
    #[action]
    fn reduce_disk_budget(delta_supply: Quantity) {
        unimplemented!()
    }

    /// Returns the current cost of consuming the specified number of bytes
    #[action]
    fn get_disk_cost(bytes: u64) -> Quantity {
        unimplemented!()
    }

    /// Gets the estimated refund amount for freeing the specified number of bytes
    #[action]
    fn disk_ref_quote(bytes: u64) -> Quantity {
        unimplemented!()
    }

    /// Called by the system to indicate that the specified user has consumed a
    /// given amount of network bandwidth.
    ///
    /// If billing is enabled, the user will be billed for the consumption of
    /// this resource.
    #[action]
    fn useNetSys(user: AccountNumber, amount_bytes: u64) {
        unimplemented!()
    }

    /// Called by the system to indicate that the specified user has consumed a
    /// given amount of CPU.
    ///
    /// If billing is enabled, the user will be billed for the consumption of
    /// this resource.
    #[action]
    fn useCpuSys(user: AccountNumber, amount_ns: u64) {
        unimplemented!()
    }

    /// A notification called at the end of a transaction in which to do any final
    /// per-tx accounting or cleanup.
    #[action]
    fn finishTx() {
        unimplemented!()
    }

    /// Called by the system when `user` causes a write to any database.
    ///
    /// `amount_bytes` is positive for consumption and negative for a free
    ///
    /// If billing is enabled, the user may be billed from (or refunded to)
    ///   their resource buffer, depending on the specified database and the
    ///  amount of bytes consumed/freed.
    #[action]
    fn useDiskSys(user: AccountNumber, db_id: DbId, amount_bytes: i64) {
        unimplemented!()
    }

    #[action]
    fn get_resources(user: AccountNumber) -> Quantity {
        unimplemented!()
    }

    #[action]
    fn notifyBlock(block_num: BlockNum) {
        unimplemented!()
    }

    /// A notification called before the start of a transaction with the specified top-level
    /// action senders. Used for any pre-tx initialization.
    #[action]
    fn prestartTx(actors: Vec<AccountNumber>) {
        unimplemented!()
    }

    /// This action specifies which account is primarily responsible for
    /// paying the bill for any consumed resources.
    ///
    /// A time limit for the execution of the current tx/query will be set based
    /// on the resources available for the specified account.
    #[action]
    fn setBillableAcc(account: AccountNumber) {
        unimplemented!()
    }

    #[action]
    fn serveSys(
        request: HttpRequest,
        _socket: Option<i32>,
        user: Option<AccountNumber>,
    ) -> Option<HttpReply> {
        unimplemented!()
    }

    #[event(history)]
    fn consumed(account: AccountNumber, resource: u8, amount: i64, cost: i64) {}

    #[event(history)]
    fn subsidized(
        purchaser: AccountNumber,
        recipient: AccountNumber,
        amount: u64,
        memo: crate::Memo,
    ) {
    }

    #[event(history)]
    fn block_summary(net_usage_ppm: u32, cpu_usage_ppm: u32, disk_usage_ppm: u32) {}
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
