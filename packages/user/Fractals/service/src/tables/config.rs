use psibase::Table;

use crate::tables::tables::{Config, ConfigTable};

impl Config {
    fn new() -> Self {
        Self { last_levy_id: 0 }
    }

    pub fn get_assert() -> Self {
        ConfigTable::read()
            .get_index_pk()
            .get(&())
            .unwrap_or_else(|| Self::new())
    }

    pub fn next_levy_id() -> u32 {
        let mut config = Self::get_assert();
        config.last_levy_id += 1;
        config.save();
        config.last_levy_id
    }

    fn save(&self) {
        ConfigTable::read_write()
            .put(&self)
            .expect("failed to save");
    }
}
