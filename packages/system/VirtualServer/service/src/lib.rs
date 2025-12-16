mod prices;
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
#[psibase::service(name = "virtual-server", tables = "tables::tables", recursive = true)]
mod service {
    use crate::tables::tables::*;
    use crate::{prices::*, rpc::event_types};
    use psibase::services::{
        accounts::Wrapper as Accounts,
        nft::{NftHolderFlags, Wrapper as Nft},
        tokens::{BalanceFlags, Quantity, TokenFlags, Wrapper as Tokens},
        transact::Wrapper as Transact,
    };
    use psibase::*;

    #[action]
    fn init() {
        InitRow::init();

        Nft::call().setUserConf(NftHolderFlags::MANUAL_DEBIT.index(), true);
        Tokens::call().setUserConf(BalanceFlags::MANUAL_DEBIT.index(), true);
        Wrapper::call().set_specs(MIN_SERVER_SPECS);
        Transact::call().resMonitoring(true);
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

        let table = BillingConfigTable::new();

        check(
            table.get_index_pk().get(&()).is_none(),
            "Billing already initialized",
        );

        let tok = Tokens::call();
        let sys = check_some(tok.getSysToken(), "System token not found");

        let config = BillingConfig {
            sys: sys.id,
            res: tok.create(sys.precision, sys.max_issued_supply),
            fee_receiver,
            enabled: false,
        };
        table.put(&config).unwrap();

        Nft::call().debit(config.res, "".into());
        tok.mint(config.res, sys.max_issued_supply, "".into());
        tok.setTokenConf(config.res, TokenFlags::UNTRANSFERABLE.index(), true);
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

    /// Allows a user to buy resource tokens to pay for the resources consumed when transacting
    /// with the network. The user must already have used the `Tokens::credit` action to credit
    /// this service with the system token,
    #[action]
    fn buy_res(amount: Quantity) {
        let config = check_some(BillingConfig::get(), "Billing not initialized");

        let sys = config.sys;
        let res = config.res;

        let buyer = get_sender();

        Tokens::call().debit(sys, buyer, amount, "".into());
        Tokens::call().credit(sys, config.fee_receiver, amount, "".into());
        Tokens::call().credit(res, buyer, amount, "".into()); // TODO: should be credit-sub

        Wrapper::emit()
            .history()
            .resources(buyer, event_types::BOUGHT, amount.value);
    }

    fn bill(user: AccountNumber, amount: u64) {
        if let Some(config) = BillingConfig::get() {
            let res = config.res;
            Tokens::call().recall(res, user, amount.into(), "".into());
            Tokens::call().mint(res, amount.into(), "".into());
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

    /// Called by the system to indicate that the specified user has consumed a
    /// given amount of network bandwidth.
    ///
    /// If billing is enabled, the user will be billed for the consumption of
    /// this resource.
    #[allow(non_snake_case)]
    #[action]
    fn useNetSys(user: AccountNumber, amount_bytes: u64) {
        let _amount = amount_bytes.saturating_mul(Prices::get_price(Resource::NetworkBandwidth));
        check(_amount < u64::MAX, "network usage overflow");

        if BillingConfig::get().map(|c| c.enabled).unwrap_or(false) {
            bill(user, 1); // TODO: implement network bandwidth pricing
        }

        Wrapper::emit()
            .history()
            .resources(user, event_types::CONSUMED_NET, _amount);
    }

    /// Called by the system to indicate that the specified user has consumed a
    /// given amount of CPU.
    ///
    /// If billing is enabled, the user will be billed for the consumption of
    /// this resource.
    #[allow(non_snake_case)]
    #[action]
    fn useCpuSys(user: AccountNumber, amount_ns: u64) {
        let _amount = amount_ns.saturating_mul(Prices::get_price(Resource::Compute));
        check(_amount < u64::MAX, "cpu usage overflow");

        if BillingConfig::get().map(|c| c.enabled).unwrap_or(false) {
            bill(user, 1); // TODO: implement cpu pricing
        }

        Wrapper::emit()
            .history()
            .resources(user, event_types::CONSUMED_CPU, _amount);
    }

    #[event(history)]
    fn resources(actor: AccountNumber, action: u8, amount: u64) {}

    #[action]
    #[allow(non_snake_case)]
    fn serveSys(request: HttpRequest) -> Option<HttpReply> {
        None.or_else(|| serve_graphql(&request, crate::rpc::Query))
            .or_else(|| serve_graphiql(&request))
    }
}

#[cfg(test)]
mod tests;
