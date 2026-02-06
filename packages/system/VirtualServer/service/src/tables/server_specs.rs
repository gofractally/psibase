use crate::tables::tables::{ServerSpecs, ServerSpecsTable, MIN_SERVER_SPECS};
use psibase::*;

const MAX_SERVER_SPECS: ServerSpecs = ServerSpecs {
    net_bps: u64::MAX,       // Unlimited
    storage_bytes: u64::MAX, // Unlimited
};

impl ServerSpecs {
    pub fn set(new_specs: &Self) {
        new_specs.validate();

        let mut specs = Self::get_or_new();
        specs.net_bps = new_specs.net_bps;
        specs.storage_bytes = new_specs.storage_bytes;
        ServerSpecsTable::read_write().put(&specs).unwrap();
    }

    pub fn get() -> Option<Self> {
        ServerSpecsTable::read().get_index_pk().get(&())
    }

    fn get_or_new() -> Self {
        Self::get().unwrap_or_default()
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
