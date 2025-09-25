use psibase::Table;

use crate::tables::tables::{Config, ConfigTable};

impl Config {
    pub fn new() -> Self {
        Self { last_id: 0 }
    }

    pub fn get_assert() -> Self {
        ConfigTable::read()
            .get_index_pk()
            .get(&{})
            .unwrap_or_else(|| {
                let new_instance = Self::new();
                new_instance.save();
                new_instance
            })
    }

    pub fn gen_id(&mut self) -> u32 {
        self.last_id = self.last_id + 1;
        self.save();
        self.last_id
    }

    fn save(&self) {
        ConfigTable::read_write()
            .put(&self)
            .expect("failed to save config");
    }
}
