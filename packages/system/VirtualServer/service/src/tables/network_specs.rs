use crate::tables::tables::*;
use psibase::services::producers::Wrapper as Producers;
use psibase::*;

impl NetworkSpecs {
    /// Bytes of objective server storage that are not available to the network
    ///
    /// Reductions here reduce the max billable storage, which is better than treating
    /// the offsets like a normal "consumption" because then whoever enables billing
    ///  would be required to settle a much larger virtual balance.
    pub(crate) fn obj_storage_offset() -> u64 {
        // code uploaded at boot
        InitRow::code_bytes()

        // One misc gigabyte
        + 1_000_000_000
    }

    fn derive_net(vars: &NetworkVariables, specs: &ServerSpecs) -> u64 {
        let net_bps = specs.net_bps;
        let max_bp_peers = Producers::call().getMaxProds();
        check(
            net_bps > vars.block_replay_factor as u64 * max_bp_peers as u64,
            "Insufficient network bandwidth",
        );

        // Reduce bps to account for:
        // - increased replay speed
        let mut net_bps = net_bps / vars.block_replay_factor as u64;
        // - constant cost multiplier incurred by each network peer
        // We use max_network_peers instead of actual so that the billing doesn't change as
        // the actual peer set changes.
        net_bps = net_bps / max_bp_peers as u64;

        net_bps
    }

    fn derive_cpu(vars: &NetworkVariables) -> u64 {
        let mut cpu_ns = 1_000_000_000; // 1 s

        // Reduce cpu ns to account for:
        // - per-block system functionality
        cpu_ns = cpu_ns - vars.per_block_sys_cpu_ns;
        // - increased replay speed
        cpu_ns = cpu_ns / vars.block_replay_factor as u64;

        cpu_ns
    }

    fn derive_obj_storage(vars: &NetworkVariables) -> u64 {
        let offset = Self::obj_storage_offset();
        vars.obj_storage_bytes
            .checked_sub(offset)
            .unwrap_or_else(|| {
                abort_message(&format!(
                    "obj_storage_bytes cannot be less than {offset} bytes)"
                ))
            })
    }

    fn derive_subj_storage(vars: &NetworkVariables) -> u64 {
        // Todo: Consider a reserve? E.g. mempool
        vars.subj_storage_bytes
    }

    pub fn update() {
        let server_specs = ServerSpecs::get().unwrap_or_default();
        let vars = NetworkVariables::get();

        let table = NetworkSpecsTable::read_write();
        let old_specs = table.get_index_pk().get(&()).unwrap_or_default();

        let new_specs = NetworkSpecs {
            net_bps: Self::derive_net(&vars, &server_specs),
            cpu_ns: Self::derive_cpu(&vars),
            obj_storage_bytes: Self::derive_obj_storage(&vars),
            subj_storage_bytes: Self::derive_subj_storage(&vars),
        };

        check(
            old_specs.obj_storage_bytes <= new_specs.obj_storage_bytes,
            "Objective storage allocation cannot decrease",
        );
        check(
            old_specs.subj_storage_bytes <= new_specs.subj_storage_bytes,
            "Subjective storage allocation cannot decrease",
        );

        table.put(&new_specs).unwrap();
    }

    pub fn get_assert() -> Self {
        check_some(
            NetworkSpecsTable::read().get_index_pk().get(&()),
            "Network specs not yet initialized",
        )
    }
}
