use crate::tables::tables::*;
use async_graphql::ComplexObject;
use psibase::services::tokens::{Quantity, Wrapper as Tokens};
use psibase::*;

// Relatively arbitrary initial values
const EXAMPLE_LARGE_TX_COST: u64 = 3_000_000; // e.g. Net cost of a 3MB upload when NET is at minimum cost
pub const DEFAULT_AUTO_FILL_THRESHOLD_PERCENT: u8 = 20;

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

    pub fn to_sub_account_key(account: AccountNumber, sub_account: &str) -> String {
        format!("{}.{}", account, sub_account)
    }

    pub fn get_resource_balance(account: AccountNumber, sub_account: Option<String>) -> Quantity {
        Self::get_resource_balance_opt(account, sub_account).unwrap_or(0.into())
    }

    pub fn get_resource_balance_opt(
        account: AccountNumber,
        sub_account: Option<String>,
    ) -> Option<Quantity> {
        let sub_account_key = if let Some(sub_account) = sub_account {
            Self::to_sub_account_key(account, &sub_account)
        } else {
            account.to_string()
        };

        Tokens::call().getSubBal(BillingConfig::get_assert().sys, sub_account_key)
    }

    fn get_min_buffer_capacity() -> u64 {
        // Ensures that the large tx could still be submitted when at the refill threshold
        EXAMPLE_LARGE_TX_COST * 100 / (DEFAULT_AUTO_FILL_THRESHOLD_PERCENT as u64)
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
