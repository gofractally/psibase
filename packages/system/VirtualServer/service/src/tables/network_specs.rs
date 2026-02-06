use crate::tables::tables::*;
use psibase::services::producers::Wrapper as Producers;
use psibase::*;

impl NetworkSpecs {
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

    fn derive_storage(vars: &NetworkVariables, specs: &ServerSpecs) -> u64 {
        check(
            specs.storage_bytes >= vars.obj_storage_bytes,
            "Total server storage must exceed objective storage",
        );

        if let Some(network_specs) = NetworkSpecsTable::read().get_index_pk().get(&()) {
            check(
                network_specs.obj_storage_bytes <= vars.obj_storage_bytes,
                "Total objective storage amount cannot decrease",
            );
        }

        vars.obj_storage_bytes
    }

    pub fn set_from(specs: &ServerSpecs) {
        let vars = NetworkVariables::get();

        let net_bps = Self::derive_net(&vars, &specs);
        let cpu_ns = Self::derive_cpu(&vars);
        let obj_storage_bytes = Self::derive_storage(&vars, &specs);
        let subj_storage_bytes = specs.storage_bytes - obj_storage_bytes;

        NetworkSpecsTable::read_write()
            .put(&NetworkSpecs {
                net_bps,
                cpu_ns,
                obj_storage_bytes,
                subj_storage_bytes,
            })
            .unwrap();
    }

    pub fn get_assert() -> Self {
        check_some(
            NetworkSpecsTable::read().get_index_pk().get(&()),
            "Network specs not yet initialized",
        )
    }
}
