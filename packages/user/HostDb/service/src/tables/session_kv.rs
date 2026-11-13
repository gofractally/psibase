use crate::policy::{idle_cutoff, SESSION_RETENTION_SECS};
use crate::tables::tables::*;
use psibase::{Table, TimePointSec};

impl SessionKvRow {
    pub(crate) fn new(
        store: &[u8],
        session: u32,
        key: &[u8],
        value: &[u8],
        last_access: TimePointSec,
    ) -> Self {
        Self {
            store: store.to_vec(),
            session,
            key: key.to_vec(),
            value: value.to_vec(),
            last_access,
        }
    }
}

impl SessionKvTable {
    pub(crate) fn value(&self, store: &[u8], session: u32, key: &[u8]) -> Option<Vec<u8>> {
        self.get_index(0)
            .get(&(store, session, key))
            .map(|row| row.value)
    }

    /// Rewrites `last_access` when the row exists and it differs from `now`.
    pub(crate) fn touch(&self, store: &[u8], session: u32, key: &[u8], now: TimePointSec) {
        let Some(mut row) = self.get_index(0).get(&(store, session, key)) else {
            return;
        };
        if row.last_access != now {
            row.last_access = now;
            self.put(&row).unwrap();
        }
    }

    pub(crate) fn erase_idle(&self, now: TimePointSec) {
        let cutoff = idle_cutoff(now, SESSION_RETENTION_SECS);
        let rows: Vec<_> = self
            .get_index_by_last_access()
            .range(..(cutoff, Vec::new(), 0, Vec::new()))
            .take(GC_LIMIT)
            .collect();
        for row in rows {
            self.remove(&row);
        }
    }
}
