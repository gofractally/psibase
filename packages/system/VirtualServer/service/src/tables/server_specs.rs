use crate::tables::tables::{ServerSpecs, ServerSpecsTable, MIN_SERVER_SPECS};
use psibase::*;

const MAX_SERVER_SPECS: ServerSpecs = ServerSpecs {
    net_bps: u64::MAX,       // Unlimited
    storage_bytes: u64::MAX, // Unlimited
};

impl ServerSpecs {
    pub fn set(specs: &Self) {
        specs.validate();

        let net_bps = specs.net_bps;
        let storage_bytes = specs.storage_bytes;

        let table = ServerSpecsTable::read_write();
        let mut specs = table.get_index_pk().get(&()).unwrap_or_default();
        specs.net_bps = net_bps;
        specs.storage_bytes = storage_bytes;
        table.put(&specs).unwrap();
    }

    pub fn get() -> Option<Self> {
        ServerSpecsTable::read().get_index_pk().get(&())
    }

    fn validate(&self) {
        Self::check_range(
            self.net_bps,
            MIN_SERVER_SPECS.net_bps,
            MAX_SERVER_SPECS.net_bps,
            "Network bandwidth",
        );
        Self::check_range(
            self.storage_bytes,
            MIN_SERVER_SPECS.storage_bytes,
            MAX_SERVER_SPECS.storage_bytes,
            "Storage space",
        );
    }

    fn check_range(value: u64, min: u64, max: u64, field_name: &str) {
        check(value >= min, &format!("{} too low", field_name));
        check(value <= max, &format!("{} too high", field_name));
    }
}
