use psibase::Table;

use super::constants::{DEVICE_ID_LEN, DEVICE_IDLE_NS, GC_LIMIT, ID_LEN};
use super::ids::mint_random;
use crate::tables::tables::{DeviceRow, DeviceTable, KvTable};

/// Returns an existing device row's store prefix, if any.
pub(crate) fn existing_device_store(devices: &DeviceTable, device: &[u8]) -> Option<Vec<u8>> {
    devices.get_index(0).get(&device).map(|row| row.store)
}

/// Returns `device`'s row prefix, refreshing `last_seen` and creating the
/// prefix on first sight.
pub(crate) fn device_store(devices: &DeviceTable, device: &[u8], now: u64) -> Vec<u8> {
    match devices.get_index(0).get(&device) {
        Some(mut row) => {
            row.last_seen = now;
            devices.put(&row).unwrap();
            row.store
        }
        None => {
            let store = mint_random::<ID_LEN>();
            devices
                .put(&DeviceRow {
                    device: device.to_vec(),
                    last_seen: now,
                    store: store.clone(),
                })
                .unwrap();
            store
        }
    }
}

/// Deletes up to `GC_LIMIT` persistent rows of idle devices, oldest first.
pub(crate) fn collect_idle_devices(devices: &DeviceTable, persistent: &KvTable, now: u64) {
    let cutoff = now.saturating_sub(DEVICE_IDLE_NS);
    let idle: Vec<_> = devices
        .get_index_by_last_seen()
        .range(..(cutoff, Vec::new()))
        .take(GC_LIMIT)
        .collect();
    let mut budget = GC_LIMIT;
    for row in idle {
        let erased = collect_one(devices, persistent, row, budget);
        budget -= erased;
        if budget == 0 {
            break;
        }
    }
}

/// Erases rows for one idle device and drops its id. When rows remain, the
/// same prefix continues under a new id.
fn collect_one(
    devices: &DeviceTable,
    persistent: &KvTable,
    row: DeviceRow,
    budget: usize,
) -> usize {
    let (erased, drained) = erase_store_rows(persistent, &row.store, budget);
    devices.erase(&row.device);
    if !drained {
        devices.put(&replacement_device(row, mint_random::<DEVICE_ID_LEN>())).unwrap();
    }
    erased
}

/// Same prefix under `new_id`.
pub(crate) fn replacement_device(row: DeviceRow, new_id: Vec<u8>) -> DeviceRow {
    DeviceRow {
        device: new_id,
        last_seen: row.last_seen,
        store: row.store,
    }
}

/// Erases up to `limit` rows under `store`. Returns how many were erased
/// and whether none remain.
fn erase_store_rows(persistent: &KvTable, store: &[u8], limit: usize) -> (usize, bool) {
    let mut keys: Vec<_> = persistent
        .get_index(0)
        .range((store, &[] as &[u8])..)
        .take_while(|row| row.store == store)
        .take(limit + 1)
        .map(|row| row.key)
        .collect();
    let drained = keys.len() <= limit;
    keys.truncate(limit);
    for key in &keys {
        persistent.erase(&(store, key));
    }
    (keys.len(), drained)
}
