use crate::resource_type::ResourceType;
use crate::tables::tables::{BillingConfig, CapacityPricing, CapacityPricingTable, UserSettings};
use crate::tx_cache::{accrual, balance_cache};
use psibase::services::tokens::{Decimal, Quantity, Wrapper as Tokens};
use psibase::{abort_message, get_service, AccountNumber, Table};
use std::collections::HashMap;

/// Pays fees out to the configured `fee_receiver`.
pub fn credit_fee_receiver(amount: u64) {
    if amount > 0 {
        let c = BillingConfig::get_assert();
        Tokens::call().credit(c.sys, c.fee_receiver, amount.into(), "".into());
    }
}

/// End-of-tx settlement:
/// * one per-payer settlement
/// * one per-relay settlement
/// * one fee-receiver credit
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
            Tokens::call().toSub(sys, key(account, sub), Quantity::new(*net as u64));
        }
    }

    // 5. Credit the fee receiver
    credit_fee_receiver(to_fee_receiver);
}

/// Used when enabling billing to capitalize any relay shortfall
/// The specified payer is simply paying for it out of pocket
/// Todo: consider constructing a new curve when billing is enabled for the first time to
///       avoid requiring some particular payer to subsidize everyone else's prior writes.
pub fn settle_relay_balance(resource: ResourceType, payer: AccountNumber) {
    let net = CapacityPricing::get_assert(resource).relay_net();
    if net == 0 {
        return;
    }
    let config = BillingConfig::get_assert();
    let sys = config.sys;
    if net > 0 {
        let amt = Quantity::new(net as u64);
        let shared = Tokens::call().getSharedBal(sys, payer, get_service());
        if shared < amt {
            let precision = BillingConfig::get_sys_token().precision;
            let paid = Decimal::new(shared, precision);
            let required = Decimal::new(amt, precision);
            abort_message(&format!(
                "Account {payer} has paid {paid} tokens, but enabling billing requires {required} tokens"
            ));
        }
        Tokens::call().debit(sys, payer, amt, "".into());
        CapacityPricing::settle_relay(resource, net);
        Tokens::call().reject(sys, payer, "Change".into());
    } else {
        CapacityPricing::settle_relay(resource, net);
        credit_fee_receiver((-net) as u64);
    }
}
