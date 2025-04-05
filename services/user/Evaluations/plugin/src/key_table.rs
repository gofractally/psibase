use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;
use crate::bindings::host::common::types::Error;
use ecies::{decrypt, encrypt, utils::generate_keypair, PublicKey, SecretKey};
use psibase::fracpack::{Pack, Unpack};
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
