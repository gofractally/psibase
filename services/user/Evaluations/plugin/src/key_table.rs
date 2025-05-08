use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;
use crate::bindings::host::common::types::Error;
use crate::errors::ErrorType;
use ecies::{utils::generate_keypair, PublicKey};
use psibase::{
    fracpack::{Pack, Unpack},
    AccountNumber,
};
use rand::Rng;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Pack, Unpack, Debug, Default)]
pub struct AsymKey {
    pub created_at: u32,
    pub private_key: Vec<u8>,
}

const KEY: &str = "asym_keys";

pub fn get() -> Result<Vec<AsymKey>, Error> {
    let keys = Keyvalue::get(KEY);
    keys.map(|c| {
        <Vec<AsymKey>>::unpacked(&c).map_err(|_| ErrorType::KeyDeserializationFailed.into())
    })
    .unwrap_or(Ok(Vec::new()))
}

pub fn get_latest() -> Option<AsymKey> {
    get().ok()?.into_iter().last()
}

pub fn save(keys: Vec<AsymKey>) -> Result<(), Error> {
    Keyvalue::set(KEY, &keys.packed())
}

pub fn add(new_key: AsymKey) -> Result<(), Error> {
    let mut current_keys = get()?;
    current_keys.push(new_key);
    current_keys.sort_by_key(|k| k.created_at);
    save(current_keys)
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

#[derive(Pack, Unpack, Debug, Default)]
pub struct SymmetricKey {
    pub key: Vec<u8>,
    salt: Vec<u8>,
}

use sha2::{Digest, Sha256};

impl SymmetricKey {
    fn storage_key(owner: AccountNumber, evaluation_id: u32, group_number: u32) -> String {
        format!("symmetric_key_{}_{}_{}", owner, evaluation_id, group_number)
    }

    pub fn salt_base_64(&self) -> String {
        crate::bindings::base64::plugin::standard::encode(&self.salt)
    }

    pub fn from_storage(
        owner: AccountNumber,
        evaluation_id: u32,
        group_number: u32,
    ) -> Result<Option<Self>, Error> {
        let key = Self::storage_key(owner, evaluation_id, group_number);
        let key_value = Keyvalue::get(&key);
        Ok(match key_value {
            Some(value) => Some(
                SymmetricKey::unpacked(&value).map_err(|_| ErrorType::KeyDeserializationFailed)?,
            ),
            None => None,
        })
    }

    pub fn hash(&self) -> String {
        let mut combined = self.key.clone();
        combined.extend_from_slice(&self.salt);
        let key_hash = Sha256::digest(combined);
        crate::bindings::base64::plugin::standard::encode(&key_hash)
    }

    pub fn new(bytes: Vec<u8>, salt: Vec<u8>) -> Self {
        Self { key: bytes, salt }
    }

    pub fn generate(salt: Vec<u8>) -> Self {
        let new_shared_symmetric_key: [u8; 32] = rand::thread_rng().random();
        Self {
            key: new_shared_symmetric_key.to_vec(),
            salt,
        }
    }

    pub fn save(
        &self,
        owner: AccountNumber,
        evaluation_id: u32,
        group_number: u32,
    ) -> Result<(), Error> {
        let key = Self::storage_key(owner, evaluation_id, group_number);
        let packed_key = self.packed();
        Keyvalue::set(&key, &packed_key)
    }
}
