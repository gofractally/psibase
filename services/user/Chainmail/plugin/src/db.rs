use crate::{bindings::*, get_unix_time_from_iso8601_str};
use crate::{schedule_action, Actions};
use ::chainmail::get_group_id;
use accounts::plugin::api as Accounts;
use clientdata::plugin::keyvalue as Keyvalue;
use ecies::{utils::generate_keypair, PublicKey};
use psibase::TimePointSec;
use psibase::{
    fracpack::{Pack, Unpack},
    AccountNumber,
};
use std::time::{SystemTime, UNIX_EPOCH};

fn get_current_time() -> u32 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as u32
}

fn current_user() -> AccountNumber {
    let current_user = Accounts::get_current_user().unwrap().unwrap();
    current_user.as_str().into()
}

#[derive(Pack, Unpack, Debug, Default, Clone)]
struct MessagingKey {
    private_key: [u8; 32],
    created_at: u32,
    last_used: Option<u32>,
}

impl MessagingKey {
    fn new() -> Self {
        let me = Self {
            private_key: generate_keypair().0.serialize(),
            created_at: get_current_time(),
            last_used: None,
        };

        schedule_action(Actions::set_key { key: me.pubkey() });

        me
    }

    fn pubkey(&self) -> Vec<u8> {
        PublicKey::from_secret_key(&ecies::SecretKey::parse(&self.private_key).unwrap())
            .serialize_compressed()
            .to_vec()
    }
}

#[derive(Pack, Unpack, Debug, Default, Clone)]
struct KeyData {
    past_keys: Vec<MessagingKey>,
    current_key: MessagingKey,
}

pub struct PrivateMessaging {
    user: AccountNumber,
    key_data: Option<KeyData>,
}

impl PrivateMessaging {
    const KEY: &str = "messaging_keys";

    // Namespaced to the currently logged-in user
    fn make_primary_key(user: AccountNumber) -> String {
        format!("{}_{}", Self::KEY, user)
    }

    fn primary_key(&self) -> String {
        Self::make_primary_key(self.user)
    }

    fn save(&self) {
        Keyvalue::set(&self.primary_key(), &self.key_data.packed()).unwrap();
    }

    fn load(&mut self) {
        let existing = Keyvalue::get(&Self::make_primary_key(self.user))
            .map(|data| Option::<KeyData>::unpacked(&data).unwrap().unwrap());
        if let Some(existing) = existing {
            self.key_data = Some(existing);
        }
    }

    // This will initialize the table to hold the current user's messaging keys
    // If the current user has no messaging keys, it will create (and publish) a new one
    pub fn init() -> Self {
        let mut me = Self {
            user: current_user(),
            key_data: None,
        };

        me.load();

        if me.key_data.is_some() {
            me
        } else {
            me.key_data = Some(KeyData {
                past_keys: vec![],
                current_key: MessagingKey::new(),
            });
            me.save();

            me
        }
    }

    // Rotate to a new messaging key
    // Returns the new public key
    pub fn rotate(&mut self) {
        let key_data = self
            .key_data
            .as_mut()
            .expect("No key data found, nothing to rotate");
        key_data.past_keys.push(key_data.current_key.clone());
        key_data.current_key = MessagingKey::new();
        self.save();
    }

    // Decrypts a message using the messaging key of the currently logged-in user
    // Returns the decrypted message or an error if the message cannot be decrypted
    // Will try up to ten of the user's prior keys.
    pub fn decrypt(&mut self, cipher: &[u8]) -> Vec<u8> {
        let key_data = self.key_data.as_mut().unwrap();

        // Try with current key first
        if let Ok(decrypted) = ecies::decrypt(&key_data.current_key.private_key, cipher) {
            key_data.current_key.last_used = Some(get_current_time());
            self.save();
            return decrypted;
        }

        // Try with the 10 past keys
        for key in key_data.past_keys.iter_mut().rev().take(10) {
            if let Ok(decrypted) = ecies::decrypt(&key.private_key, cipher) {
                key.last_used = Some(get_current_time());
                self.save();
                return decrypted;
            }
        }

        panic!("Decryption failed");
    }
}

#[derive(Pack, Unpack, Debug, Default, Clone)]
struct Member {
    account: AccountNumber,
    messaging_pubkey: Vec<u8>,
}

#[derive(Pack, Unpack, Debug, Default, Clone)]
pub struct Group {
    id: String,
    members: Vec<Member>,
}

impl Group {
    const KEY: &str = "group";

    fn primary_key(&self) -> String {
        format!("{}_{}", Self::KEY, self.id)
    }

    fn save(&self) {
        Keyvalue::set(&self.primary_key(), &self.packed()).unwrap();
    }

    fn load(
        &mut self,
        _members: &Vec<AccountNumber>,
        _expiry: Option<TimePointSec>,
        _name: Option<String>,
        _description: Option<String>,
    ) {
        let existing =
            Keyvalue::get(&self.primary_key()).map(|value| <Group>::unpacked(&value).unwrap());

        if existing.is_some() {
            *self = existing.unwrap();
            return;
        }

        // TODO - fetch from graphql, and if doesn't exist

        // let name = name.map(|n| n.as_str().into());

        // let create_group = Actions::create_group {
        //     members,
        //     expiry,
        //     name,
        //     description,
        //     secrets: todo!(),
        //     key_digest: todo!(),
        // };
    }

    pub fn init(
        members: Vec<String>,
        expiry: Option<String>,
        name: Option<String>,
        description: Option<String>,
    ) -> Self {
        let members = members.iter().map(|m| m.as_str().into()).collect();
        let expiry = expiry.map(|e| TimePointSec::from(get_unix_time_from_iso8601_str(e).unwrap()));

        let group_id = get_group_id(&members);

        let mut me = Self {
            id: group_id.to_string(),
            members: vec![],
        };

        me.load(&members, expiry, name, description);

        me
    }

    pub fn id(&self) -> String {
        self.id.clone()
    }
}
