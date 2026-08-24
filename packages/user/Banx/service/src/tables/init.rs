use psibase::Table;

use crate::tables::tables::{InitRow, InitTable};

impl InitRow {
    fn get_assert() -> Self {
        InitTable::read()
            .get_index_pk()
            .get(&())
            .expect("service not inited")
    }

    fn save(&self) {
        InitTable::read_write().put(self).unwrap();
    }

    /// Allocate a unique obligation primary key.
    pub fn alloc_obligation_id() -> u32 {
        let mut row = Self::get_assert();
        let id = row.next_obligation_id;
        row.next_obligation_id = row
            .next_obligation_id
            .checked_add(1)
            .expect("obligation id overflow");
        row.save();
        id
    }

    /// Allocate a unique asset id (supports a few thousand assets).
    pub fn alloc_asset_id() -> u16 {
        let mut row = Self::get_assert();
        let id = row.next_asset_id;
        row.next_asset_id = row.next_asset_id.checked_add(1).expect("asset id overflow");
        row.save();
        id
    }

    /// Allocate a unique request primary key.
    pub fn alloc_request_id() -> u32 {
        let mut row = Self::get_assert();
        let id = row.next_request_id;
        row.next_request_id = row
            .next_request_id
            .checked_add(1)
            .expect("request id overflow");
        row.save();
        id
    }
}
