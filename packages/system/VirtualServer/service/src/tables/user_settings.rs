use crate::tables::tables::*;
use psibase::*;

impl UserSettings {
    pub fn get(user: AccountNumber) -> Self {
        UserSettingsTable::read()
            .get_index_pk()
            .get(&user)
            .unwrap_or_else(|| UserSettings {
                user,
                buffer_capacity: BillingConfig::get_assert().min_resource_buffer,
            })
    }
}
