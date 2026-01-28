use crate::tables::tables::*;

use psibase::services::tokens::{TokenRecord, Wrapper as Tokens};
use psibase::*;

impl BillingConfig {
    pub fn initialize(fee_receiver: AccountNumber) {
        let table = BillingConfigTable::read_write();
        check(
            table.get_index_pk().get(&()).is_none(),
            "Billing already initialized",
        );

        let sys = check_some(Tokens::call().getSysToken(), "System token not found");

        table
            .put(&BillingConfig {
                sys: sys.id,
                fee_receiver,
                enabled: false,
            })
            .unwrap();
    }

    pub fn get() -> Option<Self> {
        BillingConfigTable::read().get_index_pk().get(&())
    }

    pub fn get_assert() -> Self {
        check_some(
            BillingConfigTable::read().get_index_pk().get(&()),
            "Billing not yet initialized",
        )
    }

    pub fn enable(enabled: bool) {
        let table = BillingConfigTable::read_write();
        let mut config = check_some(table.get_index_pk().get(&()), "Billing not yet initialized");
        config.enabled = enabled;
        table.put(&config).unwrap();
    }

    pub fn get_sys_token() -> TokenRecord {
        let config = Self::get_assert();
        Tokens::call().getToken(config.sys)
    }
}
