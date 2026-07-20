use crate::resource_type::ResourceType;
use crate::tables::tables::{BillingConfig, CapacityPricing, CapacityPricingTable, UserSettings};
use crate::tx_cache::{accrual, balance_cache};
use psibase::{
    services::tokens::{Quantity, Wrapper as Tokens},
    services::transact::Wrapper as Transact,
    AccountNumber, ServiceWrapper, Table,
};
use std::collections::HashMap;

/// Upper bound on the bytes written when crediting the fee receiver during
/// settlement.
/// Possible writes:
/// * A new primary balance record on the fee receiver account
/// * A new SharedBalance record between vserver and the fee receiver
const FEE_RECEIVER_CREDIT_MAX_BYTES: u64 = 169;

/// Pays fees out to the configured `fee_receiver`.
pub fn credit_fee_receiver(amount: u64) {
    if amount > 0 {
        // [DB WRITE] Possible allocation - Therefore must be attributed to the system account.
        // Consider finding a way to guarantee avoiding this allocation, which would avoid the need to
        // attribute it to the system account.
        Transact::call().systemWrite(FEE_RECEIVER_CREDIT_MAX_BYTES);
        let c = BillingConfig::get_assert();
        Tokens::call().credit(c.sys, c.fee_receiver, amount.into(), "".into());
        Transact::call().systemWrite(0);
    }
}

/// End-of-tx settlement:
/// * one per-payer settlement
/// * one per-relay settlement
/// * one fee-receiver credit
///
/// [DB_WRITE] WARNING:
/// As of this point in the lifecycle of the transaction, we can no longer service subsequent user billing events.
/// Therefore, all records that are updated from here on within this transaction must either have already been
/// created to avoid an allocation, or must be attributed to the system account which will cause its billing to
/// be handled as drift settlement.
pub fn reconcile() {
    let payer_accruals = balance_cache::drain_balances();
    let capacity_accruals = accrual::capacity_limited::drain();
    let rate_accruals = accrual::rate_limited::drain();

    let Some(config) = BillingConfig::get().filter(|c| c.enabled) else {
        return;
    };
    let sys = config.sys;
    let key = |account: &AccountNumber, sub: &Option<String>| {
        UserSettings::to_sub_account_key(*account, sub.clone())
    };

    // 1. Charge payers first so the service balance funds the relay/fee payouts below.
    for ((account, sub), net) in &payer_accruals {
        if *net < 0 {
            // [DB WRITE] No allocation - primary balance record for vserver already exists, it is created
            // by the first resource purchase, which must be done before billing is enabled.
            Tokens::call().fromSub(sys, key(account, sub), Quantity::new((-net) as u64));
        }
    }

    // 2. Rate-limited resources: entire fee goes to the fee receiver.
    let mut to_fee_receiver: u64 = rate_accruals.iter().map(|(_, r)| r.fee).sum();

    // 3. Capacity-limited resources
    let accrued: HashMap<ResourceType, (i128, u64)> = capacity_accruals
        .into_iter()
        .map(|(r, c)| (r, (c.relay_delta, c.fee)))
        .collect();
    let table = CapacityPricingTable::read();
    for pricing in &table.get_index_pk() {
        let resource = pricing.resource();
        let (relay_delta, fee) = accrued.get(&resource).copied().unwrap_or((0, 0));
        CapacityPricing::settle_relay(resource, relay_delta);

        // Settle drift with relay's own generated fee, leftovers go to the fee receiver
        to_fee_receiver += CapacityPricing::settle_drift(resource, fee);
    }

    // 4. Process payer resource refunds
    for ((account, sub), net) in &payer_accruals {
        if *net > 0 {
            // [DB WRITE] No allocation - primary balance record for vserver already exists, it is created
            // by the first resource purchase, which must be done before billing is enabled.
            Tokens::call().toSub(sys, key(account, sub), Quantity::new(*net as u64));
        }
    }

    // 5. Credit the fee receiver
    credit_fee_receiver(to_fee_receiver);
}
