#![allow(non_snake_case)]

pub mod resource_type;
pub mod rpc;
pub mod tables;
pub use crate::tables::DEFAULT_AUTO_FILL_THRESHOLD_PERCENT;

mod billing;
mod math_utils;

mod tx_cache {
    use psibase::{abort_message, AccountNumber};
    use std::cell::{Cell, RefCell};
    use std::collections::HashMap;
    use std::thread::LocalKey;

    /// Mutably access a billing cache
    fn with_cache<T: 'static, R>(
        cache: &'static LocalKey<RefCell<Option<T>>>,
        f: impl FnOnce(&mut T) -> R,
    ) -> R {
        cache.with_borrow_mut(|m| {
            f(m.as_mut()
                .expect("resource billing attempted during end-of-tx settlement"))
        })
    }

    /// Drain a billing cache, subsequent access panics.
    fn drain_cache<T: 'static>(cache: &'static LocalKey<RefCell<Option<T>>>) -> T {
        cache.with_borrow_mut(|m| {
            m.take()
                .expect("resource billing attempted during end-of-tx settlement")
        })
    }

    thread_local! {
        static BILLABLE_ACCOUNT: Cell<Option<AccountNumber>> = const { Cell::new(None) };
        static BILL_TO_SUB: RefCell<Option<HashMap<AccountNumber, String>>> = const { RefCell::new(None) };
        static SKIP_BILLING_COUNT: Cell<u32> = const { Cell::new(0) };
        static DISK_NET: RefCell<Option<HashMap<AccountNumber, (i64, i64)>>> = const { RefCell::new(None) };
    }

    pub fn get_billable_account() -> Option<AccountNumber> {
        BILLABLE_ACCOUNT.with(|cell| cell.get())
    }

    pub fn set_billable_account(account: AccountNumber) {
        BILLABLE_ACCOUNT.with(|cell| cell.set(Some(account)));
    }

    pub fn get_sub(user: AccountNumber) -> Option<String> {
        BILL_TO_SUB.with_borrow(|map| map.as_ref().and_then(|m| m.get(&user).cloned()))
    }

    pub fn set_sub(user: AccountNumber, sub_account: String) {
        BILL_TO_SUB.with_borrow_mut(|map| {
            map.get_or_insert_with(HashMap::new)
                .insert(user, sub_account);
        });
    }

    pub fn get_skip_count() -> u32 {
        SKIP_BILLING_COUNT.with(|c| c.get())
    }

    pub fn set_skip_count(n: u32) {
        SKIP_BILLING_COUNT.with(|c| c.set(n));
    }

    pub fn dec_skip_count() -> bool {
        SKIP_BILLING_COUNT.with(|c| {
            let n = c.get();
            if n == 0 {
                false
            } else {
                c.set(n - 1);
                true
            }
        })
    }

    pub fn add_disk_usage(user: AccountNumber, amount_bytes: i64, cost: i64) {
        DISK_NET.with_borrow_mut(|map| {
            let entry = map
                .get_or_insert_with(HashMap::new)
                .entry(user)
                .or_insert((0, 0));
            entry.0 = entry
                .0
                .checked_add(amount_bytes)
                .unwrap_or_else(|| abort_message("disk usage amount overflow"));
            entry.1 = entry
                .1
                .checked_add(cost)
                .unwrap_or_else(|| abort_message("disk usage cost overflow"));
        });
    }

    pub fn drain_disk_usage() -> Vec<(AccountNumber, i64, i64)> {
        DISK_NET.with_borrow_mut(|map| {
            map.take()
                .map(|m| m.into_iter().map(|(k, (a, c))| (k, a, c)).collect())
                .unwrap_or_default()
        })
    }

    /// Cache of account resource balances.
    /// We track updates to user resources in the cache so we can do a settlement of the actual token
    /// balances once at the end of the transaction.
    pub mod balance_cache {
        use crate::tables::tables::UserSettings;
        use crate::tx_cache::{drain_cache, with_cache};
        use psibase::services::tokens::Quantity;
        use psibase::{abort_message, AccountNumber};
        use std::cell::RefCell;
        use std::collections::HashMap;

        type Payer = (AccountNumber, Option<String>);

        #[derive(Clone, Copy)]
        struct Balance {
            available: i128,
            initial: i128,
        }

        impl Balance {
            fn from_live((account, sub): &Payer) -> Self {
                let value = UserSettings::get_resource_balance(*account, sub.clone()).value as i128;
                Balance {
                    available: value,
                    initial: value,
                }
            }

            // The amount to settle
            fn delta(self) -> i128 {
                self.available - self.initial
            }
        }

        thread_local! {
            static BALANCES: RefCell<Option<HashMap<Payer, Balance>>> =
                RefCell::new(Some(HashMap::new()));
        }

        fn with<R>(f: impl FnOnce(&mut HashMap<Payer, Balance>) -> R) -> R {
            with_cache(&BALANCES, f)
        }

        /// Applies `delta` to the payer's balance, aborts on overdraft.
        fn adjust(account: AccountNumber, sub: Option<String>, delta: i128) {
            with(|m| {
                let bal = m
                    .entry((account, sub.clone()))
                    .or_insert_with_key(Balance::from_live);
                bal.available += delta;
                if bal.available < 0 {
                    let who = UserSettings::to_sub_account_key(account, sub);
                    abort_message(&format!("{} has insufficient resource balance", who));
                }
            });
        }

        pub fn charge(account: AccountNumber, sub: Option<String>, cost: u64) {
            adjust(account, sub, -(cost as i128));
        }

        pub fn refund(account: AccountNumber, sub: Option<String>, amount: u64) {
            adjust(account, sub, amount as i128);
        }

        /// Returns whether the payer already has a pending accrual in this tx.
        pub fn has_pending(account: AccountNumber, sub: Option<String>) -> bool {
            with(|m| m.contains_key(&(account, sub)))
        }

        /// The current resource balance for the specified account
        pub fn get_available(account: AccountNumber, sub: Option<String>) -> Quantity {
            match with(|m| m.get(&(account, sub.clone())).map(|b| b.available)) {
                Some(available) => Quantity::new(available.max(0) as u64),
                None => UserSettings::get_resource_balance(account, sub),
            }
        }

        /// Handles mid-tx resource purchase/deletion.
        /// Shifts available+initial together so the delta is unchanged but the new balance is spendable.
        /// No-op if the account hasn't yet been touched for billing.
        pub fn update_balance(account: AccountNumber, sub: Option<String>, delta: i128) {
            with(|m| {
                if let Some(bal) = m.get_mut(&(account, sub)) {
                    bal.available += delta;
                    bal.initial += delta;
                }
            });
        }

        pub fn drain_balances() -> Vec<(Payer, i128)> {
            drain_cache(&BALANCES)
                .into_iter()
                .map(|(payer, b)| (payer, b.delta()))
                .collect()
        }
    }

    /// Per-tx billing accrual, settled at end of tx
    pub mod accrual {
        fn is_system_user(user: psibase::AccountNumber) -> bool {
            user == psibase::AccountNumber::new(0)
        }

        /// Rate-limited resources: consumption cost is directly credited to the fee receiver.
        pub mod rate_limited {
            use super::is_system_user;
            use crate::resource_type::ResourceType;
            use crate::tx_cache::{balance_cache, drain_cache, with_cache};
            use psibase::AccountNumber;
            use std::cell::RefCell;
            use std::collections::HashMap;

            #[derive(Default)]
            pub struct Accrual {
                pub fee: u64,
            }

            thread_local! {
                static STATE: RefCell<Option<HashMap<ResourceType, Accrual>>> =
                    RefCell::new(Some(HashMap::new()));
            }

            pub fn consume(
                resource: ResourceType,
                user: AccountNumber,
                sub: Option<String>,
                cost: u64,
            ) {
                if cost == 0 {
                    return;
                }
                if is_system_user(user) {
                    psibase::abort_message("System user consumes rate-limited resources!");
                }
                balance_cache::charge(user, sub, cost);
                with_cache(&STATE, |m| m.entry(resource).or_default().fee += cost);
            }

            pub fn drain() -> Vec<(ResourceType, Accrual)> {
                drain_cache(&STATE).into_iter().collect()
            }
        }

        /// Capacity-limited resources: consumption cost is sent as a reserve into a relay. When freed, relay refund is split between
        /// the user and the fee receiver.
        ///
        /// In rare cases (system writes or writes when billing is disabled), the relay may become under-collateralized. In such cases,
        /// tokens that would be sent to the fee receiver are instead used to recollateralize the relay.
        pub mod capacity_limited {
            use super::is_system_user;
            use crate::resource_type::ResourceType;
            use crate::tx_cache::{balance_cache, drain_cache, with_cache};
            use psibase::AccountNumber;
            use std::cell::RefCell;
            use std::collections::HashMap;

            #[derive(Default)]
            pub struct Accrual {
                pub relay_delta: i128,
                pub fee: u64,
            }

            thread_local! {
                static STATE: RefCell<Option<HashMap<ResourceType, Accrual>>> =
                    RefCell::new(Some(HashMap::new()));
            }

            fn with<R>(resource: ResourceType, f: impl FnOnce(&mut Accrual) -> R) -> R {
                with_cache(&STATE, |m| f(m.entry(resource).or_default()))
            }

            pub fn consume(
                resource: ResourceType,
                user: AccountNumber,
                sub: Option<String>,
                cost: u64,
            ) {
                if is_system_user(user) || cost == 0 {
                    return;
                }
                balance_cache::charge(user, sub, cost);
                with(resource, |a| a.relay_delta += cost as i128);
            }

            pub fn free(
                resource: ResourceType,
                user: AccountNumber,
                sub: Option<String>,
                user_refund: u64,
                fee: u64,
            ) {
                let gross = user_refund + fee;
                if is_system_user(user) || gross == 0 {
                    return;
                }
                with(resource, |a| {
                    a.relay_delta -= gross as i128;
                    a.fee += fee;
                });
                if user_refund > 0 {
                    balance_cache::refund(user, sub, user_refund);
                }
            }

            pub fn drain() -> Vec<(ResourceType, Accrual)> {
                drain_cache(&STATE).into_iter().collect()
            }
        }
    }
}

/// Virtual Server Service
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
/// 3 - Call `enable_billing(true, Some(payer))`: When ready, calling this action enables the
///     billing system. Two requirements: (a) the caller must have already filled their resource
///     buffer because this action is itself billed, and (b) `payer` must have credited sufficient
///     system tokens to this service to settle any net disk consumption that accumulated while
///     billing was disabled (see the `enableBillingCost` GraphQL query for the required amount).
///
/// > Note: typically, step 1 should be called at system boot, and therefore the network should
/// >       always at least have some server specs and derived network specs.
///
/// After each of the above steps, the billing service will be enabled, and users will be
/// required to buy resources to transact with the network. Use the other actions in this
/// service to manage server specs, network variables, and billing parameters, as needed.
#[psibase::service(name = "vserver", recursive = "true", tables = "tables::tables")]
mod service {
    use crate::billing;
    use crate::tables::tables::{UserSettings, *};
    use crate::tx_cache;
    use crate::tx_cache::accrual;
    use crate::tx_cache::balance_cache;
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

    use crate::resource_type::ResourceType;
    use ResourceType::{Cpu, Disk, Net};

    /// Sum of every row's `key + value` bytes in a database.
    fn db_used_bytes(db: DbId) -> u64 {
        let handle = KvHandle::new(db, &[], KvMode::Read);
        let mut total: u64 = 0;
        let mut key: Vec<u8> = Vec::new();
        while let Some(value_size) = kv_greater_equal_value_size(&handle, &key, 0) {
            key = get_key_bytes();
            total += key.len() as u64 + value_size as u64;
            key.push(0); // advance the cursor past the matched key
        }
        total
    }

    fn status_row_bytes() -> u64 {
        let native = KvHandle::new(DbId::Native, &[], KvMode::Read);
        let key = status_key().to_key();
        kv_get_bytes(&native, &key)
            .map(|value| key.len() as u64 + value.len() as u64)
            .unwrap_or(0)
    }

    fn get_prealloc() -> u64 {
        let native = db_used_bytes(DbId::Native);
        let service = db_used_bytes(DbId::Service);
        let status = status_row_bytes();
        native + service - status
    }

    /// Exact on-disk footprint (`key + value`) of a single fixed-width table row.
    fn row_size<R: TableRecord, T: Table<R>>(table: &T, sample: &R) -> u64 {
        let prefix = (T::SERVICE, T::TABLE_INDEX).to_key();
        let key = table.serialize_key(0, &sample.get_primary_key());
        (prefix.len() + key.data.len() + sample.packed().len()) as u64
    }

    #[action]
    fn init() {
        if InitRow::is_init() {
            return;
        }

        Nft::call().setUserConf(NftHolderFlags::MANUAL_DEBIT.index(), true);
        Tokens::call().setUserConf(BalanceFlags::MANUAL_DEBIT.index(), true);
        Tokens::call().setUserConf(BalanceFlags::KEEP_ZERO_BALANCE.index(), true);

        // Initialize network resource consumption tracking
        RateLimitPricing::initialize(Net, 5, 600, 1800, 8);
        RateLimitPricing::initialize(Cpu, 5, 600, 1800, 1_000_000);

        // Create a few records before scanning for preallocated db usage
        CapacityPricing::create_relay(Disk);
        Transact::call().resMonitoring(false);

        // `InitRow`, `NetworkSpecs`, and `CapacityPricing` are necessarily written
        // after the db scan, and before resMonitoring is enabled. Therefore we must
        // explicitly add their exact footprints to the baseline.
        let used_bytes = get_prealloc()
            + row_size(&InitTable::new(), &InitRow::default())
            + row_size(&NetworkSpecsTable::new(), &NetworkSpecs::default())
            + row_size(&CapacityPricingTable::new(), &CapacityPricing::default());

        InitRow::init(used_bytes);

        // Must run after `InitRow::init` because it transitively depends on `InitRow::used_bytes()`
        NetworkSpecs::update();
        let billable_obj_storage = NetworkSpecs::get_assert().obj_storage_bytes;

        // Disk capacity pricing parameters:
        //   `DISK_CURVE_D` controls the aggressiveness of the constant-product curve.
        //   Smaller values make pricing flatter near the endpoints; larger values
        //   make pricing steeper.
        const DISK_CURVE_D: u64 = 15;
        // Refund fee in ppm: 50% of any disk refund is paid to the fee receiver.
        const DISK_FEE_PPM: u32 = 500_000;
        CapacityPricing::initialize(Disk, billable_obj_storage, DISK_CURVE_D, DISK_FEE_PPM);

        Transact::call().resMonitoring(true);

        // Event indexes
        events::Wrapper::call().addIndex(DbId::HistoryEvent, SERVICE, method!("consumed"), 0);
        events::Wrapper::call().addIndex(DbId::HistoryEvent, SERVICE, method!("subsidized"), 0);
        events::Wrapper::call().addIndex(DbId::HistoryEvent, SERVICE, method!("subsidized"), 1);
    }

    #[pre_action(exclude(init))]
    fn check_init() {
        InitRow::check_init();
    }

    /// Initializes the billing system
    ///
    /// The `fee_receiver` account will receive all resource billing fees.
    ///
    /// After calling this action, the billing system is NOT yet enabled. The
    /// `enable_billing` action must be called explicitly to enable user billing.
    #[action]
    fn init_billing(fee_receiver: AccountNumber) {
        check(get_sender() == get_service(), "Unauthorized");
        check(Accounts::call().exists(fee_receiver), "Fee_receiver DNE");

        BillingConfig::initialize(fee_receiver);

        let max_supply = BillingConfig::get_sys_token().max_issued_supply.value;

        let pricing = CapacityPricing::get_assert(Disk);
        pricing.reduce_reserve_budget(pricing.max_reserve - max_supply);
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
        NetworkSpecs::update();
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
        NetworkSpecs::update();

        CapacityPricing::get_assert(Disk)
            .set_capacity(NetworkSpecs::get_assert().obj_storage_bytes);
    }

    /// Enable or disable the billing system
    ///
    /// If billing is disabled, resource consumption will still be tracked, but the resources will
    /// not be automatically metered by the network. This is insecure and allows users to abuse
    /// the network by consuming all of the network's resources.
    ///
    /// `payer` is required only when `enabled = true`: that account must have previously credited
    /// sufficient system tokens to this service to cover the settlement cost of any net disk
    /// consumption that occurred while billing was disabled.
    #[action]
    fn enable_billing(enabled: bool, payer: Option<AccountNumber>) {
        check(get_sender() == get_service(), "Unauthorized");

        if enabled {
            let payer = check_some(payer, "payer is required when enabling billing");
            billing::settle_relay_balance(Disk, payer);
        }

        BillingConfig::enable(enabled);
    }

    /// Returns whether the billing system has been enabled
    #[action]
    fn is_billing_enabled() -> bool {
        BillingConfig::get().map(|c| c.enabled).unwrap_or(false)
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
    fn buy_res_for(amount: Quantity, for_user: AccountNumber, memo: Option<psibase::Memo>) {
        let sys = BillingConfig::get_assert().sys;
        let buyer = get_sender();

        Tokens::call().debit(sys, buyer, amount, "".into());
        Tokens::call().toSub(sys, for_user.to_string(), amount);
        balance_cache::update_balance(for_user, None, amount.value as i128);

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
        let sys = BillingConfig::get_assert().sys;
        let buyer = get_sender();

        Tokens::call().debit(sys, buyer, amount, "".into());
        Tokens::call().toSub(
            sys,
            UserSettings::to_sub_account_key(buyer, Some(sub_account.clone())),
            amount,
        );
        balance_cache::update_balance(buyer, Some(sub_account), amount.value as i128);
    }

    /// Deletes the resource subaccount, returning the resources back to the caller's primary
    /// resource balance.
    #[action]
    fn del_res_sub(sub_account: String) {
        let Some(config) = BillingConfig::get() else {
            return;
        };
        let sys = config.sys;

        let sender = get_sender();

        // Cannot delete a sub-account that has pending billing
        check(
            !balance_cache::has_pending(sender, Some(sub_account.clone())),
            "cannot delete a sub-account that has pending billing this transaction",
        );

        let Some(balance) =
            UserSettings::get_resource_balance_opt(sender, Some(sub_account.clone()))
        else {
            return;
        };

        if balance.value != 0u64 {
            let sub_key = UserSettings::to_sub_account_key(sender, Some(sub_account.clone()));
            Tokens::call().fromSub(sys, sub_key, balance);
            Tokens::call().toSub(sys, sender.to_string(), balance);
            balance_cache::update_balance(sender, Some(sub_account), -(balance.value as i128));
            balance_cache::update_balance(sender, None, balance.value as i128);
        }
    }

    /// Gets the amount of resources available for the caller
    #[action]
    fn res_balance() -> Quantity {
        balance_cache::get_available(get_sender(), None)
    }

    /// Gets the amount of resources available for the caller's specified sub-account
    #[action]
    fn res_balance_sub(sub_account: String) -> Quantity {
        balance_cache::get_available(get_sender(), Some(sub_account))
    }

    /// Reserves system tokens for future resource consumption by the sender
    ///
    /// The reserve is consumed when interacting with metered network functionality.
    ///
    /// The sender must have already credited the system tokens to this service.
    #[action]
    fn buy_res(amount: Quantity) {
        buy_res_for(amount, get_sender(), None);
    }

    /// Allows the sender to specify one of their sub-accounts as the billable account for
    /// the current transaction.
    ///
    /// This will only succeed if the sender has already been set by `Transact` to be the
    /// billable account.
    #[action]
    fn bill_to_sub(sub_account: String) {
        let billable_account =
            check_some(tx_cache::get_billable_account(), "Billable account not set");

        check(
            !sub_account.is_empty(),
            "Billable sub-account cannot be empty",
        );

        let sender = get_sender();

        check(
            UserSettings::get_resource_balance_opt(sender, Some(sub_account.clone())).is_some(),
            "Billable sub-account does not exist",
        );

        tx_cache::set_sub(sender, sub_account.clone());

        if sender == billable_account {
            CpuLimit::rpc().setCpuLimit(get_cpu_limit(sender, Some(sub_account.clone())));
        }

        let cpu_time = CpuLimit::rpc().getCpuTime();
        psibase::write_console(&format!("CPU time at limit change: {} ns\n", cpu_time));
    }

    /// Allows the sender to manage the behavior of client-side tooling with respect to the
    /// automatic management of the sender's resource buffer.
    ///
    /// If `config` is None, the account will use a default configuration
    #[action]
    fn conf_buffer(config: Option<BufferConfig>) {
        UserSettings::get(get_sender()).configure_buffer(config);
    }

    /// Returns the current cost of a typically sized resource buffer
    #[action]
    fn std_buffer_cost() -> Quantity {
        Quantity::new(UserSettings::get_default_buffer_capacity())
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
        RateLimitPricing::get_assert(Net).set_thresholds(idle_ppm, congested_ppm);
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
        RateLimitPricing::get_assert(Net).set_change_rates(doubling_time_sec, halving_time_sec);
    }

    /// Sets the number of blocks over which to compute the average network usage.
    /// This average usage is compared to the network capacity (every block) to determine
    /// the price of network bandwidth.
    #[action]
    fn net_blocks_avg(num_blocks: u8) {
        check(get_sender() == get_service(), "Unauthorized");
        check(num_blocks > 0, "Number of blocks must be greater than 0");
        RateLimitPricing::get_assert(Net).set_num_blocks_to_average(num_blocks);
    }

    /// Sets the size of the billable unit of network bandwidth.
    ///
    /// This unit is also the minimum amount billed for bandwidth in a single transaction.
    #[action]
    fn net_min_unit(bits: u64) {
        check(get_sender() == get_service(), "Unauthorized");
        RateLimitPricing::get_assert(Net).set_billable_unit(bits);
    }

    /// Returns the current cost (in system tokens) of consuming the specified amount of network
    /// bandwidth
    #[action]
    fn get_net_cost(bytes: u64) -> Quantity {
        let bits = bytes
            .checked_mul(8)
            .unwrap_or_else(|| abort_message("get_net_cost: overflow"));
        let Some(pricing) = RateLimitPricing::get(Net) else {
            return Quantity::new(0);
        };

        let billable_unit = pricing.get_billable_unit();
        let amount_units = bits.div_ceil(billable_unit);

        let cost = pricing
            .price()
            .checked_mul(amount_units)
            .unwrap_or_else(|| abort_message("get_net_cost: overflow"));
        Quantity::new(cost)
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
        RateLimitPricing::get_assert(Cpu).set_thresholds(idle_ppm, congested_ppm);
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
        RateLimitPricing::get_assert(Cpu).set_change_rates(doubling_time_sec, halving_time_sec);
    }

    /// Sets the number of blocks over which to compute the average CPU usage.
    /// This average usage is compared to the network capacity (every block) to determine
    /// the price of CPU.
    #[action]
    fn cpu_blocks_avg(num_blocks: u8) {
        check(get_sender() == get_service(), "Unauthorized");
        check(num_blocks > 0, "Number of blocks must be greater than 0");
        RateLimitPricing::get_assert(Cpu).set_num_blocks_to_average(num_blocks);
    }

    /// Sets the size of the billable unit of CPU time.
    ///
    /// This unit is also the minimum amount billed for CPU in a single transaction.
    #[action]
    fn cpu_min_unit(ns: u64) {
        check(get_sender() == get_service(), "Unauthorized");
        RateLimitPricing::get_assert(Cpu).set_billable_unit(ns);
    }

    /// Returns the current cost (in system tokens) of consuming the specified amount of
    /// CPU time
    #[action]
    fn get_cpu_cost(ns: u64) -> Quantity {
        let Some(pricing) = RateLimitPricing::get(Cpu) else {
            return Quantity::new(0);
        };

        let billable_unit = pricing.get_billable_unit();
        let amount_units = ns.div_ceil(billable_unit);

        let cost = pricing
            .price()
            .checked_mul(amount_units)
            .unwrap_or_else(|| abort_message("get_cpu_cost: overflow"));
        Quantity::new(cost)
    }

    fn to_i64(amount: u64, context: &str) -> i64 {
        i64::try_from(amount).unwrap_or_else(|_| abort_message(&format!("{} overflow", context)))
    }

    /// Reduce the disk-pricing reserve budget by `delta_supply`.
    ///
    /// The reserve budget caps the system tokens that may be sold into the disk-pricing
    /// relay. Reducing it lowers the spot price of disk.
    #[action]
    fn reduce_disk_budget(delta_supply: Quantity) {
        check(get_sender() == get_service(), "Unauthorized");
        CapacityPricing::get_assert(Disk).reduce_reserve_budget(delta_supply.value);
    }

    /// Returns the current cost of consuming the specified number of bytes
    #[action]
    fn get_disk_cost(bytes: u64) -> Quantity {
        CapacityPricing::get(Disk)
            .map(|p| p.get_cost(bytes))
            .unwrap_or(Quantity::new(0))
    }

    /// Gets the estimated refund amount for freeing the specified number of bytes
    #[action]
    fn disk_ref_quote(bytes: u64) -> Quantity {
        CapacityPricing::get(Disk)
            .map(|p| p.refund_quote(bytes))
            .unwrap_or(Quantity::new(0))
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

        let amount_bits = check_some(amount_bytes.checked_mul(8), "network usage overflow");
        let sub = tx_cache::get_sub(user);
        let raw_cost = RateLimitPricing::get_assert(Net).consume(amount_bits);
        let cost = if is_billing_enabled() { raw_cost } else { 0 };
        accrual::rate_limited::consume(Net, user, sub, cost);

        let amount = to_i64(amount_bytes, "Consumed network bandwidth");
        let cost = to_i64(cost, "Consumed network bandwidth cost");
        Wrapper::emit()
            .history()
            .consumed(user, Net.as_id(), amount, cost);
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

        let sub = tx_cache::get_sub(user);
        let raw_cost = RateLimitPricing::get_assert(Cpu).consume(amount_ns);
        let cost = if is_billing_enabled() { raw_cost } else { 0 };
        accrual::rate_limited::consume(Cpu, user, sub, cost);

        let amount = to_i64(amount_ns, "Consumed CPU");
        let cost = to_i64(cost, "Consumed CPU cost");

        Wrapper::emit()
            .history()
            .consumed(user, Cpu.as_id(), amount, cost);

        // useCpuSys runs once at the end of a billed transaction, so this is where we
        // emit the per-tx aggregated disk `consumed` events that useDiskSys accumulated.
        for (disk_user, disk_amount, disk_cost) in tx_cache::drain_disk_usage() {
            if disk_amount == 0 && disk_cost == 0 {
                continue;
            }
            Wrapper::emit()
                .history()
                .consumed(disk_user, Disk.as_id(), disk_amount, disk_cost);
        }

        billing::reconcile();
    }

    /// Suppress billing/tracking for the next `num_writes` `useDiskSys` calls.
    ///
    /// Intended for wrapping privileged-service writes that should not
    /// be billed. The caller is expected to perform exactly `num_writes`
    /// writes/frees and then call `end_skip_billing`.
    ///
    /// Only callable by Transact
    #[action]
    fn skip_billing(num_writes: u32) {
        check(get_sender() == Transact::SERVICE, "Unauthorized");
        check(
            tx_cache::get_skip_count() == 0,
            "skip_billing already active",
        );
        tx_cache::set_skip_count(num_writes);
    }

    /// Asserts that all writes promised by `skip_billing` were consumed.
    ///
    /// Only callable by Transact
    #[action]
    fn end_skip_billing() {
        check(get_sender() == Transact::SERVICE, "Unauthorized");
        check(
            tx_cache::get_skip_count() == 0,
            "end_skip_billing called before all skipped writes occurred",
        );
    }

    /// Called by the system when `user` causes a write to any database.
    ///
    /// `amount_bytes` is positive for consumption and negative for a free
    ///
    /// If billing is enabled, the user may be billed from (or refunded to)
    ///   their resource buffer, depending on the specified database and the
    ///  amount of bytes consumed/freed.
    #[action]
    fn useDiskSys(user: AccountNumber, db_id: psibase::DbId, amount_bytes: i64) {
        check(
            get_sender() == Transact::SERVICE,
            "[useDiskSys] Unauthorized",
        );

        if tx_cache::dec_skip_count() {
            return;
        }

        if amount_bytes == 0 {
            return;
        }

        let billing = is_billing_enabled();
        let sub = tx_cache::get_sub(user);

        let cost = match db_id {
            DbId::Service | DbId::Native => {
                if amount_bytes > 0 {
                    let c = CapacityPricing::get_assert(Disk).consume(amount_bytes as u64);
                    if billing {
                        accrual::capacity_limited::consume(Disk, user, sub, c);
                        to_i64(c, "Disk consume cost")
                    } else {
                        0
                    }
                } else {
                    // amount_bytes < 0
                    let (user_refund, fee) =
                        CapacityPricing::get_assert(Disk).free((-amount_bytes) as u64);
                    if billing {
                        accrual::capacity_limited::free(Disk, user, sub, user_refund, fee);
                        -(to_i64(user_refund, "Disk refund"))
                    } else {
                        0
                    }
                }
            }
            DbId::HistoryEvent | DbId::UiEvent | DbId::MerkleEvent | DbId::WriteOnly => return, // TODO: Event billing (rate-limit-style)
            DbId::BlockLog | DbId::BlockProof => return, // TODO: Billing (obj storage offset, correlated with NET consumption)

            // Subjectively billed databases:
            DbId::Subjective | DbId::NativeSubjective => return,

            // Unbilled databases:
            DbId::PrevAuthServices | DbId::Session | DbId::NativeSession | DbId::Temporary => {
                return
            }

            DbId::NumChainDatabases => abort_message("NumChainDatabases is not a valid database"),
        };

        // Avoiding a flood of events for writing individual records. Accumulate in the tx_cache and emit
        // one event at the end of the tx (using `useCpuSys` as the tx end hook)
        tx_cache::add_disk_usage(user, amount_bytes, cost);
    }

    #[action]
    fn get_resources(user: AccountNumber) -> Quantity {
        let config = BillingConfig::get_assert();

        Tokens::call()
            .getSubBal(config.sys, user.to_string())
            .unwrap_or(0.into())
    }

    #[action]
    fn notifyBlock(block_num: BlockNum) {
        check(get_sender() == Transact::SERVICE, "Unauthorized");

        let net_usage = RateLimitPricing::get_assert(Net).new_block();
        let cpu_usage = RateLimitPricing::get_assert(Cpu).new_block();
        let disk_usage = CapacityPricing::get(Disk)
            .map(|p| p.utilization_ppm())
            .unwrap_or(0);

        // Emit the block usage stats every 10 blocks
        if block_num % 10 == 0 {
            Wrapper::emit()
                .history()
                .block_summary(net_usage, cpu_usage, disk_usage);
        }
    }

    // Gets the CPU limit (in ns) for the specified account
    //
    // Returns None if there is no limit for the specified account
    fn get_cpu_limit(account: AccountNumber, sub_account: Option<String>) -> Option<u64> {
        if !is_billing_enabled() {
            return None;
        }

        let cpu_pricing = RateLimitPricing::get_assert(Cpu);
        let res_balance = balance_cache::get_available(account, sub_account).value;

        let price_per_unit = cpu_pricing.price();
        let ns_per_unit = cpu_pricing.billable_unit;

        let full_block_units = NetworkSpecs::get_assert().cpu_ns / ns_per_unit; // rounded down
        let affordable_units = res_balance / price_per_unit;
        let limit_units = min(full_block_units, affordable_units);
        let mut limit_ns = limit_units * ns_per_unit;

        // The purpose of adding "leeway" is to allow for some additional cpu time in which the
        //   user may increase their available CPU. As long as the cpu_time is updated before the leeway
        //   time expires, the transaction can proceed. The user is still billed for the full CPU time of
        //   the transaction at the end.
        const CPU_LEEWAY: u64 = 5_000_000u64; // 5 ms
        limit_ns = limit_ns.saturating_add(CPU_LEEWAY);
        limit_ns = min(limit_ns, NetworkSpecs::get_assert().cpu_ns);

        Some(limit_ns)
    }

    /// This action specifies which account is primarily responsible for
    /// paying the bill for any consumed resources.
    ///
    /// A time limit for the execution of the current tx/query will be set based
    /// on the resources available for the specified account.
    #[action]
    fn setBillableAcc(account: AccountNumber) {
        check(get_sender() == Transact::SERVICE, "Unauthorized");

        tx_cache::set_billable_account(account);

        CpuLimit::rpc().setCpuLimit(get_cpu_limit(account, None));
    }

    #[action]
    fn serveSys(
        request: HttpRequest,
        _socket: Option<i32>,
        user: Option<AccountNumber>,
    ) -> Option<HttpReply> {
        check(
            get_sender() == psibase::services::http_server::SERVICE,
            "permission denied: serveSys only callable by http-server service",
        );

        None.or_else(|| serve_graphql(&request, crate::rpc::Query { user }))
            .or_else(|| serve_graphiql(&request))
    }

    // Negative values indicate free/refund
    #[event(history)]
    fn consumed(account: AccountNumber, resource: u8, amount: i64, cost: i64) {}

    #[event(history)]
    fn subsidized(
        purchaser: AccountNumber,
        recipient: AccountNumber,
        amount: u64,
        memo: psibase::Memo,
    ) {
    }

    #[event(history)]
    fn block_summary(net_usage_ppm: u32, cpu_usage_ppm: u32, disk_usage_ppm: u32) {}
}

#[cfg(test)]
mod tests;
