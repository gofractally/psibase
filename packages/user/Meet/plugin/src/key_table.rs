use crate::bindings::host::db::store::{Bucket, Database, DbMode, StorageDuration};
use crate::bindings::host::types::types::Error;
use crate::errors::ErrorType;
use ecies::{utils::generate_keypair, PublicKey};
use psibase::fracpack::{Pack, Unpack};
use std::time::{SystemTime, UNIX_EPOCH};

fn keys_table() -> Bucket {
    Bucket::new(
        Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        },
        "meet-keys",
    )
}

#[derive(Pack, Unpack, Debug, Default)]
pub struct AsymKey {
    pub created_at: u32,
    pub private_key: Vec<u8>,
}

const KEY: &str = "asym_keys";

pub fn get() -> Result<Vec<AsymKey>, Error> {
    let keys = keys_table().get(KEY);
    keys.map(|c| {
        <Vec<AsymKey>>::unpacked(&c).map_err(|_| ErrorType::KeyDeserializationFailed.into())
    })
    .unwrap_or(Ok(Vec::new()))
}

pub fn get_latest() -> Option<AsymKey> {
    get().ok()?.into_iter().last()
}

pub fn save(keys: Vec<AsymKey>) {
    keys_table().set(KEY, &keys.packed());
}

pub fn add(new_key: AsymKey) -> Result<(), Error> {
    let mut current_keys = get()?;
    current_keys.push(new_key);
    current_keys.sort_by_key(|k| k.created_at);
    save(current_keys);
    Ok(())
}

impl AsymKey {
    pub fn new() -> Self {
        let (private_key, _) = generate_keypair();
        let unix_time = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_secs() as u32;

        Self {
            private_key: private_key.serialize().to_vec(),
            created_at: unix_time,
        }
    }

    pub fn save(self) -> Result<(), Error> {
        add(self)
    }

    pub fn public_key(&self) -> Result<PublicKey, Error> {
        let key_bytes: [u8; 32] = self
            .private_key
            .clone()
            .try_into()
            .map_err(|_| ErrorType::InvalidKeyLength)?;
        let secret_key =
            ecies::SecretKey::parse(&key_bytes).map_err(|_| ErrorType::InvalidPrivateKey)?;
        Ok(PublicKey::from_secret_key(&secret_key))
    }
}

pub fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

pub fn hash_key(key: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    to_hex(&Sha256::digest(key))
}
