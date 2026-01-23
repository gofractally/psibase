use crate::tables::tables::*;
use async_graphql::ComplexObject;
use psibase::services::tokens::{Quantity, Wrapper as Tokens};
use psibase::*;

// Relatively arbitrary initial values
const EXAMPLE_LARGE_TX_COST: u64 = 3_000_000; // e.g. Net cost of a 3MB upload when NET is at minimum cost
const DEFAULT_AUTO_FILL_THRESHOLD_PERCENT: u8 = 20;

impl UserSettings {
    pub fn get(user: AccountNumber) -> Self {
        UserSettingsTable::read()
            .get_index_pk()
            .get(&user)
            .unwrap_or_else(|| UserSettings {
                user,
                buffer_capacity: None,
                auto_fill_threshold_percent: None,
            })
    }

    pub fn set_auto_fill(self, threshold_percent: u8) {
        check(
            threshold_percent <= 100,
            "Threshold must be between 0 and 100 inclusive",
        );

        let mut settings = self;
        settings.auto_fill_threshold_percent = Some(threshold_percent);
        UserSettingsTable::read_write().put(&settings).unwrap();
    }

    pub fn get_auto_fill_threshold_percent(&self) -> u8 {
        self.auto_fill_threshold_percent
            .unwrap_or(DEFAULT_AUTO_FILL_THRESHOLD_PERCENT)
    }

    pub fn set_capacity(self, capacity: u64) {
        let min_buffer_size = self.get_min_buffer_capacity();
        if capacity < min_buffer_size {
            let err_msg = format!("Buffer capacity must be >= {}", min_buffer_size);
            abort_message(&err_msg);
        }

        let mut settings = self;
        settings.buffer_capacity = Some(capacity);
        UserSettingsTable::read_write().put(&settings).unwrap();
    }

    pub fn get_buffer_capacity(&self) -> u64 {
        let default_capacity = self.get_min_buffer_capacity() * 5;
        self.buffer_capacity.unwrap_or(default_capacity)
    }

    pub fn get_resource_balance(user: AccountNumber) -> Quantity {
        let config = check_some(BillingConfig::get(), "Billing not initialized");

        let res = config.res;
        let balance = Tokens::call().getSubBal(res, user.to_string());
        let balance: Quantity = balance.unwrap_or(0.into());
        return balance;
    }

    pub fn get_min_buffer_capacity(&self) -> u64 {
        // Ensures that the large tx could still be submitted when at the refill threshold
        let threshold = std::cmp::max(self.get_auto_fill_threshold_percent(), 1);
        EXAMPLE_LARGE_TX_COST * 100 / (threshold as u64)
    }
}

#[ComplexObject]
impl UserSettings {
    /// The minimum capacity of the resource buffer
    pub async fn min_buffer_capacity(&self) -> u64 {
        self.get_min_buffer_capacity()
    }
}
