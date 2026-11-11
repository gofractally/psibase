use crate::policy::{idle_cutoff, DEVICE_ID_LEN, DEVICE_RETENTION_SECS};
use crate::tables::tables::*;
use psibase::{random_bytes, Table, TimePointSec};

impl DeviceRow {
    fn new(device: &[u8], now: TimePointSec, store: &[u8]) -> Self {
        Self {
            device: device.to_vec(),
            last_seen: now,
            store: store.to_vec(),
        }
    }

    fn with_new_device(&self, device: Vec<u8>) -> Self {
        Self {
            device,
            last_seen: self.last_seen,
            store: self.store.clone(),
        }
    }

    /// Same store prefix, new random device id (idle GC when KV rows remain).
    fn retain_store_new_id(&self) -> Self {
        self.with_new_device(random_bytes(DEVICE_ID_LEN))
    }
}

impl DeviceTable {
    /// Returns `device`'s store prefix when it already has a row. Does not write.
    pub(crate) fn existing_store(&self, device: &[u8]) -> Option<Vec<u8>> {
        self.get_index(0).get(&device).map(|row| row.store)
    }

    /// Returns `device`'s store prefix, creating it on first sight.
    /// Rewrites `last_seen` when it differs from `now`.
    pub(crate) fn touch_store(&self, device: &[u8], now: TimePointSec) -> Vec<u8> {
        match self.get_index(0).get(&device) {
            Some(mut row) => {
                if row.last_seen != now {
                    row.last_seen = now;
                    self.put(&row).unwrap();
                }
                row.store
            }
            None => {
                let store = random_bytes(STORE_PREFIX_LEN);
                self.put(&DeviceRow::new(device, now, &store)).unwrap();
                store
            }
        }
    }

    /// Deletes up to `GC_LIMIT` persistent rows of idle devices, oldest first.
    pub(crate) fn collect_idle(&self, persistent: &KvTable, now: TimePointSec) {
        let cutoff = idle_cutoff(now, DEVICE_RETENTION_SECS);
        let idle: Vec<_> = self
            .get_index_by_last_seen()
            .range(..(cutoff, Vec::new()))
            .take(GC_LIMIT)
            .collect();
        let mut budget = GC_LIMIT;
        for row in idle {
            let erased = self.collect_one_idle(persistent, row, budget);
            budget -= erased;
            if budget == 0 {
                break;
            }
        }
    }

    fn collect_one_idle(&self, persistent: &KvTable, row: DeviceRow, budget: usize) -> usize {
        let (erased, drained) = persistent.erase_store(&row.store, budget);
        self.erase(&row.device);
        if !drained {
            self.put(&row.retain_store_new_id()).unwrap();
        }
        erased
    }
}
