use crate::tables::tables::*;
use psibase::services::tokens::{Quantity, Wrapper as Tokens};
use psibase::*;

impl UserSettings {
    pub fn get(user: AccountNumber) -> Self {
        UserSettingsTable::read()
            .get_index_pk()
            .get(&user)
            .unwrap_or_else(|| UserSettings {
                user,
                buffer_capacity: None,
                auto_fill_threshold_percent: 20,
            })
    }

    pub fn set_auto_fill(self, threshold_percent: u8) {
        let mut settings = self;
        settings.auto_fill_threshold_percent = threshold_percent;
        UserSettingsTable::read_write().put(&settings).unwrap();
    }

    pub fn set_capacity(self, capacity: u64) {
        let mut settings = self;
        settings.buffer_capacity = Some(capacity);
        UserSettingsTable::read_write().put(&settings).unwrap();
    }

    pub fn get_resource_balance(user: AccountNumber) -> Quantity {
        let config = check_some(BillingConfig::get(), "Billing not initialized");

        let res = config.res;
        let balance = Tokens::call().getSubBal(res, user.to_string());
        let balance: Quantity = balance.unwrap_or(0.into());
        return balance;
    }
}
