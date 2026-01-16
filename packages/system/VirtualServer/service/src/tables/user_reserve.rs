use crate::tables::tables::*;
use psibase::services::tokens::{Quantity, Wrapper as Tokens};
use psibase::*;
use std::cmp::min;

impl UserReserve {
    pub fn init(user: AccountNumber) {
        UserReserveTable::read_write()
            .put(&UserReserve { user, reserve: 0 })
            .unwrap();
    }

    pub fn get_balance(user: AccountNumber) -> u64 {
        UserReserveTable::read()
            .get_index_pk()
            .get(&user)
            .expect("User reserve not initialized")
            .reserve
    }

    fn to_reserve(user: AccountNumber, amount: u64) {
        let config = check_some(BillingConfig::get(), "Billing not initialized");
        let res = config.res;

        Tokens::call().fromSub(res, user.to_string(), Quantity::new(amount));

        let reserve_table = UserReserveTable::read_write();

        let mut record = reserve_table
            .get_index_pk()
            .get(&user)
            .expect("User reserve not initialized");

        record.reserve += amount;
        reserve_table.put(&record).unwrap();
    }

    /// Reserves resources necessary to afford up to a full block's worth of CPU.
    /// Returns the number of CPU ns reserved.
    /// 
    /// This effectively limits the maximum CPU consumption of a single transaction.
    pub fn reserve_cpu_limit(account: AccountNumber) -> u64 {
        // Strategy:
        // Return the entire block's worth of CPU ns or the number of cpu ns the account can
        //  currently afford, whichever is less. Then, reserve this limit to ensure the CPU cost
        //  of the current tx is covered.
        //
        // Implication: If the account can't afford a full block's worth of CPU, they can't afford
        //  *any* just-in-time billed resources (like storage), because their entire buffer is
        //  reserved for CPU.

        let prereserved_balance = Self::get_balance(account);
        let balance: u64 = UserSettings::get_resource_balance(account).value + prereserved_balance;

        let table = CpuPricingTable::read();
        let ns_per_unit =
            check_some(table.get_index_pk().get(&()), "CPU time not initialized").billable_unit;
        let price_per_unit = CpuPricing::price();

        // Get the CPU limit in terms of a number of billable units
        let full_block_cpu_units = NetworkSpecs::get().cpu_ns / ns_per_unit; // rounded down
        let affordable_units = balance / price_per_unit;
        let limit_units = min(full_block_cpu_units, affordable_units);

        // Ensure we have the resources reserved to cover the CPU limit
        let mut required_reserve_amt = limit_units * price_per_unit;

        // The reserve is usually non-zero, because it's unlikely the full reserved CPU time was
        //   consumed by the last transaction. Therefore, the amount pulled from the user's
        //   resource buffer should usually be less than a full block's worth of CPU, even though
        //   a full block is typically held in reserve.
        // This means that in the worst-case, a user could fully exhaust their resource balance on a
        //   tx that consumed very little CPU, and the account would be unusable even though there's
        //   a full block's worth of CPU reserved (because it couldn't pay for the other JIT resources
        //   needed to execute tx to refill their resource balance). At that point, another account
        //   would be required to subsidize resources on behalf of the user.
        required_reserve_amt = required_reserve_amt.saturating_sub(prereserved_balance);
        Self::to_reserve(account, required_reserve_amt);

        // Need to return the CPU limit in terms of nanoseconds
        limit_units * ns_per_unit
    }

    pub fn bill(user: AccountNumber, amount: u64) {
        let table = UserReserveTable::read_write();

        let mut record = table
            .get_index_pk()
            .get(&user)
            .expect("User reserve not initialized");

        if record.reserve < amount {
            let err_msg = format!(
                "User {} reserve insufficient for amount: {} < {}",
                user.to_string(),
                record.reserve,
                amount
            );
            abort_message(&err_msg);
        }

        record.reserve -= amount;
        table.put(&record).unwrap();
    }
}
