use crate::resource_type::ResourceType;
use crate::tables::tables::*;
use async_graphql::ComplexObject;
use psibase::services::tokens::{Quantity, Wrapper as Tokens};
use psibase::*;

pub const DEFAULT_AUTO_FILL_THRESHOLD_PERCENT: u8 = 20;

struct ResourceRequirement {
    disk: u64,
    net: u64,
    cpu: u64,
}

// Manually measured - Resources required for a token credit action
const SIMPLE_ACTION_REQ: ResourceRequirement = ResourceRequirement {
    disk: 144,
    net: 113,
    cpu: 15,
};

const LARGE_TX_MULTIPLIER: u8 = 10;

fn simple_action_cost() -> u64 {
    let disk = CapacityPricing::get_assert(ResourceType::Disk)
        .get_cost(SIMPLE_ACTION_REQ.disk)
        .value;
    let net = SIMPLE_ACTION_REQ.net * RateLimitPricing::get_assert(ResourceType::Net).price();
    let cpu = SIMPLE_ACTION_REQ.cpu * RateLimitPricing::get_assert(ResourceType::Cpu).price();
    disk + net + cpu
}

impl UserSettings {
    pub fn get(user: AccountNumber) -> Self {
        UserSettingsTable::read()
            .get_index_pk()
            .get(&user)
            .unwrap_or_else(|| UserSettings {
                user,
                buffer_capacity: Self::get_default_buffer_capacity(),
                auto_fill_threshold_percent: DEFAULT_AUTO_FILL_THRESHOLD_PERCENT,
            })
    }

    pub fn configure_buffer(&mut self, config: Option<BufferConfig>) {
        if let Some(config) = config {
            check(
                config.threshold_percent <= 100,
                "Threshold must be between 0 and 100 inclusive",
            );
            if config.threshold_percent != 0 {
                // If the threshold is 0, capacity isn't used so it can be anything
                let min_buffer_size = Self::get_min_buffer_capacity();
                check(
                    config.capacity > min_buffer_size,
                    &format!("Capacity must be greater than {} bytes", min_buffer_size),
                );
            }

            self.buffer_capacity = config.capacity;
            self.auto_fill_threshold_percent = config.threshold_percent;
            UserSettingsTable::read_write().put(self).unwrap();
        } else {
            UserSettingsTable::read_write().remove(self);
        }
    }

    pub fn to_sub_account_key(account: AccountNumber, sub_account: Option<String>) -> String {
        if let Some(sub_account) = sub_account {
            format!("{}.{}", account, sub_account)
        } else {
            account.to_string()
        }
    }

    pub fn get_resource_balance(account: AccountNumber, sub_account: Option<String>) -> Quantity {
        Self::get_resource_balance_opt(account, sub_account).unwrap_or(0.into())
    }

    pub fn get_resource_balance_opt(
        account: AccountNumber,
        sub_account: Option<String>,
    ) -> Option<Quantity> {
        let sub_account_key = Self::to_sub_account_key(account, sub_account);
        Tokens::call().getSubBal(BillingConfig::get_assert().sys, sub_account_key)
    }

    fn get_min_buffer_capacity() -> u64 {
        // Ensures that the large tx could still be submitted when at the refill threshold
        let large_tx_cost = simple_action_cost() * LARGE_TX_MULTIPLIER as u64;
        large_tx_cost * 100 / (DEFAULT_AUTO_FILL_THRESHOLD_PERCENT as u64)
    }

    pub fn get_default_buffer_capacity() -> u64 {
        // This factor is used to set the default buffer capacity to an arbitrary multiple
        // of the minimum buffer capacity
        const FACTOR: u64 = 5;
        Self::get_min_buffer_capacity() * FACTOR
    }
}

#[ComplexObject]
impl UserSettings {
    /// The minimum capacity of the resource buffer
    pub async fn min_buffer_capacity(&self) -> u64 {
        Self::get_min_buffer_capacity()
    }
}
