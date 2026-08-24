use psibase::{services::tokens::Precision, AccountNumber, Memo, Table};

use crate::tables::tables::{Asset, AssetTable, InitRow};

impl Asset {
    fn save(&self) {
        AssetTable::read_write().put(self).unwrap();
    }

    fn new(symbol: AccountNumber, precision: Precision, description: Memo) -> Self {
        Self {
            id: InitRow::alloc_asset_id(),
            symbol,
            precision,
            description,
        }
    }

    pub fn get(id: u16) -> Option<Self> {
        AssetTable::read().get_index_pk().get(&id)
    }

    pub fn get_assert(id: u16) -> Self {
        Self::get(id).expect("asset not found")
    }

    pub fn get_by_symbol(symbol: AccountNumber) -> Option<Self> {
        AssetTable::read().get_index_by_symbol().get(&symbol)
    }

    pub fn get_by_symbol_assert(symbol: AccountNumber) -> Self {
        Self::get_by_symbol(symbol).expect("asset symbol not found")
    }

    /// Register a new asset; allocates the next `id` from [`InitRow`].
    pub fn add(symbol: AccountNumber, precision: Precision, description: Memo) -> Self {
        assert!(
            Self::get_by_symbol(symbol).is_none(),
            "asset symbol already exists"
        );
        let asset = Self::new(symbol, precision, description);
        asset.save();
        asset
    }
}
