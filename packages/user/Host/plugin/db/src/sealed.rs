use crate::crypto::{decrypt_value, derive_storage_keys, encrypt_value, hmac_storage_key};
use crate::supervisor::bridge::{database as HostDb, intf::get_client_key};

pub(crate) struct SealedStore {
    keys: crate::crypto::StorageKeys,
}

impl SealedStore {
    pub(crate) fn open() -> Self {
        Self {
            keys: derive_storage_keys(&get_client_key()),
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
}
