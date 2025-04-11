use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;
use crate::bindings::host::common::types::Error;
use ecies::{decrypt, encrypt, utils::generate_keypair, PublicKey, SecretKey};
use psibase::fracpack::{Pack, Unpack};
use rand::Rng;
use std::time::{SystemTime, UNIX_EPOCH};

#[derive(Pack, Unpack, Debug, Default)]
pub struct AsymKey {
    pub created_at: u32,
    pub private_key: Vec<u8>,
}

const KEY: &str = "asym_keys";

pub fn get() -> Vec<AsymKey> {
    let keys = Keyvalue::get(KEY);
    keys.map(|c| <Vec<AsymKey>>::unpacked(&c).unwrap())
        .unwrap_or_default()
}

pub fn get_latest() -> Option<AsymKey> {
    get().into_iter().last()
}

pub fn save(keys: Vec<AsymKey>) -> Result<(), Error> {
    Keyvalue::set(KEY, &keys.packed())
}

pub fn add(new_key: AsymKey) -> Result<(), Error> {
    let mut current_keys = get();
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

    pub fn public_key(&self) -> PublicKey {
        let key_bytes: [u8; 32] = self.private_key.clone().try_into().unwrap();
        let secret_key = ecies::SecretKey::parse(&key_bytes).unwrap();
        PublicKey::from_secret_key(&secret_key)
    }
}

pub struct SymmetricKey {
    pub key: Vec<u8>,
    pub salt: String,
}

use sha2::{Digest, Sha256};

impl SymmetricKey {
    fn generate_salt(evaluation_id: u32, group_number: u32) -> String {
        // use the submitters K1 public key to generate a salt
        format!("{}_{}", evaluation_id, group_number)
    }

    fn storage_key(evaluation_id: u32) -> String {
        format!("symmetric_key_{}", evaluation_id)
    }

    pub fn from_storage(evaluation_id: u32, group_number: u32) -> Option<Self> {
        let key = Self::storage_key(evaluation_id);
        let key_value = Keyvalue::get(&key);
        if key_value.is_some() {
            Some(Self {
                key: key_value.unwrap(),
                salt: Self::generate_salt(evaluation_id, group_number),
            })
        } else {
            None
        }
    }

    pub fn hash(&self) -> String {
        let key_hash = Sha256::digest(self.key.clone());
        crate::bindings::base64::plugin::standard::encode(&key_hash)
    }

    pub fn new(bytes: Vec<u8>, evaluation_id: u32, group_number: u32) -> Self {
        Self {
            key: bytes,
            salt: Self::generate_salt(evaluation_id, group_number),
        }
    }

    pub fn generate(evaluation_id: u32, group_number: u32) -> Self {
        let new_shared_symmetric_key: [u8; 32] = rand::thread_rng().gen();

        Self {
            key: new_shared_symmetric_key.to_vec(),
            salt: Self::generate_salt(evaluation_id, group_number),
        }
    }

    pub fn save(&self, evaluation_id: u32) -> Result<(), Error> {
        Keyvalue::set(&(Self::storage_key(evaluation_id)), &self.key.packed())
    }
}
