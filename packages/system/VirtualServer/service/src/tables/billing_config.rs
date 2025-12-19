use crate::tables::tables::*;
use psibase::services::{
    nft::Wrapper as Nft,
    tokens::{TokenFlags, Wrapper as Tokens},
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

        const DEFAULT_RESOURCE_BUFFER_SIZE: u64 = 10;
        let config = BillingConfig {
            sys: sys.id,
            res: tok.create(sys.precision, sys.max_issued_supply),
            fee_receiver,
            min_resource_buffer: DEFAULT_RESOURCE_BUFFER_SIZE
                * 10u64.pow(sys.precision.value() as u32),
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
}
