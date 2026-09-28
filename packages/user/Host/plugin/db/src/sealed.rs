use std::cell::RefCell;

use crate::crypto::{
    decrypt_value, derive_storage_keys, encrypt_value, hmac_storage_key, StorageKeys,
};
use crate::supervisor::bridge::{database as HostDb, intf::get_client_key};

// The supervisor never replaces the client key, so derive it once per thread.
thread_local! {
    static DERIVED_KEYS: RefCell<Option<StorageKeys>> = RefCell::new(None);
}

fn derived_keys() -> StorageKeys {
    if let Some(keys) = DERIVED_KEYS.with(|slot| *slot.borrow()) {
        return keys;
    }
    let keys = derive_storage_keys(&get_client_key());
    DERIVED_KEYS.with(|slot| *slot.borrow_mut() = Some(keys));
    keys
}

pub(crate) struct SealedStore {
    keys: StorageKeys,
}

impl SealedStore {
    pub(crate) fn open() -> Self {
        Self {
            keys: derived_keys(),
        }
    }

    fn storage_key(&self, plaintext_key: &str) -> String {
        hmac_storage_key(&self.keys.hmac_key, plaintext_key)
    }

    pub(crate) fn get(&self, duration: u8, plaintext_key: &str) -> Option<Vec<u8>> {
        let storage_key = self.storage_key(plaintext_key);
        let stored = HostDb::get(duration, &storage_key)?;
        Some(
            decrypt_value(&self.keys.aes_key, storage_key.as_bytes(), &stored)
                .unwrap_or_else(|_| panic!("host:db value failed to decrypt")),
        )
    }

    pub(crate) fn set(&self, duration: u8, plaintext_key: &str, value: &[u8]) {
        let storage_key = self.storage_key(plaintext_key);
        let stored = encrypt_value(&self.keys.aes_key, storage_key.as_bytes(), value);
        HostDb::set(duration, &storage_key, &stored);
    }

    pub(crate) fn remove(&self, duration: u8, plaintext_key: &str) {
        HostDb::remove(duration, &self.storage_key(plaintext_key));
    }

    pub(crate) fn exists(&self, duration: u8, plaintext_key: &str) -> bool {
        HostDb::get(duration, &self.storage_key(plaintext_key)).is_some()
    }
}
