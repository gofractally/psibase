use psibase::Table;

use crate::tables::tables::{Config, ConfigTable};

impl Config {
    pub fn gen_id() -> u64 {
        let table = ConfigTable::new();
        let mut instance = table.get_index_pk().get(&{}).unwrap_or_default();
        let next_id = instance.last_used_id + 1;
        instance.last_used_id = next_id;
        table.put(&instance).unwrap();
        next_id
    }
}
