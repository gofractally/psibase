use psibase::{check_some, AccountNumber, Memo, Table};

use crate::tables::tables::{Config, Guild, GuildTable, GID};

impl Guild {
    fn new(fractal: AccountNumber, rep: AccountNumber, display_name: Memo) -> Self {
        Self {
            id: Config::get_assert().gen_id(),
            fractal,
            bio: "".to_string().try_into().unwrap(),
            display_name,
            rep: Some(rep),
        }
    }

    pub fn add(fractal: AccountNumber, rep: AccountNumber, display_name: Memo) -> Self {
        let new_instance = Self::new(fractal, rep, display_name);
        new_instance.save();
        new_instance
    }

    pub fn get(id: GID) -> Option<Self> {
        GuildTable::read().get_index_pk().get(&id)
    }

    pub fn get_assert(id: GID) -> Self {
        check_some(Self::get(id), "guild does not exist")
    }

    fn save(&self) {
        GuildTable::read_write().put(&self).expect("failed to save");
    }
}
