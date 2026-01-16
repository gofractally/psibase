use crate::tables::tables::*;
use async_graphql::ComplexObject;
use psibase::services::{
    nft::Wrapper as Nft,
    tokens::{TokenFlags, TokenRecord, Wrapper as Tokens},
};
use psibase::*;

impl BillingConfig {
    pub fn initialize(fee_receiver: AccountNumber) {
        let table = BillingConfigTable::read_write();
        check(
            table.get_index_pk().get(&()).is_none(),
            "Billing already initialized",
        );

        let tok = Tokens::call();
        let sys = check_some(tok.getSysToken(), "System token not found");

        let config = BillingConfig {
            sys: sys.id,
            res: tok.create(sys.precision, sys.max_issued_supply),
            fee_receiver,
            enabled: false,
        };

        Nft::call().debit(tok.getToken(config.res).nft_id, "".into());
        tok.mint(config.res, sys.max_issued_supply, "".into());
        tok.setTokenConf(config.res, TokenFlags::UNTRANSFERABLE.index(), true);

        table.put(&config).unwrap();
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

    pub fn get_min_resource_buffer() -> u64 {
        /*
            Default buffer size is currently set by the following logic:
             - The refill threshold is (by default) 20% of the buffer capacity
             - Refill threshold should be set such that a very large transaction would still succeed
               even if the user was exactly at the refill threshold.
             - Network bandwidth is billed per byte, minimum cost per billable unit is 1 (ie 0.0001
               system tokens if the precision is 4)
             - Current sites plugin enforces max file size upload = 3MB
             - 3MB = 3,000,000 bytes = 300.0000 resource tokens in network bandwidth cost alone when cost
               is at minimum
             - Therefore default capacity of 10,000 resource tokens makes 20% == 2,000, which is
               plenty to afford a single large transaction
        */
        const DEFAULT_RESOURCE_BUFFER_SIZE: u64 = 10_000;

        let tok = Tokens::call();
        let sys = check_some(tok.getSysToken(), "System token not found");
        DEFAULT_RESOURCE_BUFFER_SIZE * 10u64.pow(sys.precision.value() as u32)
    }

    pub fn enable(enabled: bool) {
        let table = BillingConfigTable::read_write();
        let mut config = check_some(table.get_index_pk().get(&()), "Billing not yet initialized");
        config.enabled = enabled;
        table.put(&config).unwrap();
    }

    pub fn get_if_enabled() -> Self {
        let table = BillingConfigTable::read();
        let config = check_some(table.get_index_pk().get(&()), "Billing not yet initialized");
        check(config.enabled, "Billing not enabled");
        config
    }

    pub fn get_sys_token() -> TokenRecord {
        let config = Self::get_assert();
        Tokens::call().getToken(config.sys)
    }
}

#[ComplexObject]
impl BillingConfig {
    /// The minimum capacity of the resource buffer
    pub async fn min_resource_buffer(&self) -> u64 {
        Self::get_min_resource_buffer()
    }
}
