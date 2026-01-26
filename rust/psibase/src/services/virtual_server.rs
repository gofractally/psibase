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
}

#[crate::service(name = "virtual-server", dispatch = false, psibase_mod = "crate")]
#[allow(non_snake_case, unused_variables)]
mod service {
    use super::{NetworkVariables, ServerSpecs};
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
    /// If no specs are provided, some default specs are used that define a server
    ///   with minimal specs.
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
    fn buy_res_for(amount: Quantity, for_user: AccountNumber, memo: Option<crate::Memo>) {
        unimplemented!()
    }

    /// Used to acquire resource tokens for the sender
    ///
    /// The resource tokens are consumed when interacting with metered network functionality.
    ///
    /// The sender must have already credited the system token to this service to pay
    /// for the specified amount of resource tokens. The exchange rate is always 1:1.
    #[action]
    fn buy_res(amount: Quantity) {
        unimplemented!()
    }

    /// Allows the sender to request client-side tooling to automatically attempt to
    /// refill their resource buffer when it is at or below the threshold (specified
    /// in integer percentage values).
    ///
    /// A threshold of 0 means that the client should not attempt to refill the
    /// resource buffer.
    #[action]
    fn conf_auto_fill(threshold_percent: u8) {
        unimplemented!()
    }

    /// Allows the sender to specify the capacity of their resource buffer. The larger the
    /// resource buffer, the less often the sender will need to refill it.
    #[action]
    fn conf_buffer(capacity: u64) {
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

    #[action]
    fn get_resources(user: AccountNumber) -> Quantity {
        unimplemented!()
    }

    #[action]
    fn notifyBlock(block_num: BlockNum) {
        unimplemented!()
    }

    /// This actions sets the CPU limit for the specified account.
    /// If the current tx exceeds the limit (ns), then the tx will timeout and fail.
    #[action]
    fn setCpuLimit(account: AccountNumber) {
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
    fn consumed(account: AccountNumber, resource: u8, amount: u64, cost: u64) {}

    #[event(history)]
    fn subsidized(
        purchaser: AccountNumber,
        recipient: AccountNumber,
        amount: u64,
        memo: crate::Memo,
    ) {
    }

    #[event(history)]
    fn block_summary(block_num: BlockNum, net_usage_ppm: u32, cpu_usage_ppm: u32) {}
}

#[test]
fn verify_schema() {
    crate::assert_schema_matches_package::<Wrapper>();
}
