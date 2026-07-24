use crate::tables::tables::*;

use async_graphql::ComplexObject;
use psibase::services::tokens::{TokenRecord, Wrapper as Tokens};
use psibase::*;

impl BillingConfig {
    pub fn initialize(fee_receiver: AccountNumber) {
        let table = BillingConfigTable::read_write();
        assert!(
            table.get_index_pk().get(&()).is_none(),
            "Billing already initialized",
        );

        let sys = Tokens::call()
            .getSysToken()
            .expect("System token not found");

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
        BillingConfigTable::read()
            .get_index_pk()
            .get(&())
            .expect("Billing not yet initialized")
    }

    pub fn is_initialized() -> bool {
        BillingConfigTable::read().get_index_pk().get(&()).is_some()
    }

    pub fn enable() {
        let table = BillingConfigTable::read_write();
        let mut config = table
            .get_index_pk()
            .get(&())
            .expect("Billing not yet initialized");
        if config.enabled {
            return;
        }
        config.enabled = true;
        table.put(&config).unwrap();
    }

    pub fn get_sys_token() -> TokenRecord {
        let config = Self::get_assert();
        Tokens::call().getToken(config.sys)
    }
}

#[ComplexObject]
impl BillingConfig {
    pub async fn initialized(&self) -> bool {
        Self::is_initialized()
    }
}
