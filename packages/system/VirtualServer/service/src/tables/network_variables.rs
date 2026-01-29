use crate::tables::tables::*;
use psibase::*;

impl NetworkVariables {
    pub fn get() -> Self {
        NetworkVariablesTable::read()
            .get_index_pk()
            .get(&())
            .unwrap_or_default()
    }
    pub fn set(vars: &Self) {
        let mut variables = Self::get();
        variables.block_replay_factor = vars.block_replay_factor;
        variables.per_block_sys_cpu_ns = vars.per_block_sys_cpu_ns;
        NetworkVariablesTable::read_write().put(&variables).unwrap();
    }
}
