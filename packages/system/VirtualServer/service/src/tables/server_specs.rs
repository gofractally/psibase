use crate::tables::tables::{NetworkVariables, ServerSpecs, ServerSpecsTable, MIN_SERVER_SPECS};
use psibase::*;

const MAX_SERVER_SPECS: ServerSpecs = ServerSpecs {
    net_bps: u64::MAX,       // Unlimited
    storage_bytes: u64::MAX, // Unlimited
};

impl ServerSpecs {
    pub fn set(new_specs: &Self) {
        new_specs.validate();
        ServerSpecsTable::read_write().put(new_specs).unwrap();
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

        let network_vars = NetworkVariables::get();
        let min_storage_bytes = network_vars.obj_storage_bytes + network_vars.subj_storage_bytes;
        check(
            self.storage_bytes >= min_storage_bytes,
            "Storage space cannot be decreased below what has already been allocated to the network",
        );
    }

    fn check_range(value: u64, min: u64, max: u64, field_name: &str) {
        check(
            value >= min,
            &format!("{} below minimum required server specs", field_name),
        );
        check(
            value <= max,
            &format!("{} above maximum allowed server specs", field_name),
        );
    }
}
