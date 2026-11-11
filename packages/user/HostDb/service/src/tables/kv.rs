use crate::tables::tables::*;
use psibase::Table;

impl KvRow {
    pub(crate) fn new(store: &[u8], key: &[u8], value: &[u8]) -> Self {
        Self {
            store: store.to_vec(),
            key: key.to_vec(),
            value: value.to_vec(),
        }
    }
}

impl KvTable {
    pub(crate) fn value(&self, store: &[u8], key: &[u8]) -> Option<Vec<u8>> {
        self.get_index(0).get(&(store, key)).map(|row| row.value)
    }

    /// Erases up to `limit` rows under `store`.
    /// Returns how many were erased and whether none remain.
    pub(crate) fn erase_store(&self, store: &[u8], limit: usize) -> (usize, bool) {
        let mut keys: Vec<_> = self
            .get_index(0)
            .range((store, &[] as &[u8])..)
            .take_while(|row| row.store == store)
            .take(limit + 1)
            .map(|row| row.key)
            .collect();
        let drained = keys.len() <= limit;
        keys.truncate(limit);
        for key in &keys {
            self.erase(&(store, key));
        }
        (keys.len(), drained)
    }
}
