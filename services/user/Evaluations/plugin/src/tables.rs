use crate::errors::ErrorType;
use crate::graphql::*;
use crate::helpers::get_current_time;
use crate::types::{EvalGroup, SymmetricKeyPassword};
use crate::{add_action_to_transaction, Actions, Error};
use crate::{bindings::*, helpers::current_user};
use clientdata::plugin::keyvalue as Keyvalue;
use ecies::{utils::generate_keypair, PublicKey};
use psibase::{
    fracpack::{Pack, Unpack},
    AccountNumber,
};

#[derive(Pack, Unpack, Debug, Default, Clone)]
pub struct AsymKey {
    pub private_key: [u8; 32],
    pub created_at: u32,
    pub last_used: Option<u32>,
}

impl AsymKey {
    fn new() -> Self {
        Self {
            private_key: generate_keypair().0.serialize(),
            created_at: get_current_time(),
            last_used: None,
        }
    }

    pub fn public_key(&self) -> PublicKey {
        PublicKey::from_secret_key(&ecies::SecretKey::parse(&self.private_key).unwrap())
    }
}

#[derive(Pack, Unpack, Debug, Default, Clone)]
pub struct KeyData {
    pub past_keys: Vec<AsymKey>,
    pub current_key: AsymKey,
}

pub struct AsymKeysTable {
    user: AccountNumber,
    key_data: Option<KeyData>,
}

impl AsymKeysTable {
    const KEY: &str = "asym_keys";

    fn make_primary_key(user: AccountNumber) -> String {
        format!("{}_asym_keys", user)
    }

    fn primary_key(&self) -> String {
        Self::make_primary_key(self.user)
    }

    fn save(&self) {
        Keyvalue::set(&self.primary_key(), &self.key_data.packed()).unwrap();
    }

    fn load(&mut self) -> Result<(), Error> {
        let existing = Keyvalue::get(&Self::make_primary_key(self.user))
            .map(|data| Option::<KeyData>::unpacked(&data).unwrap().unwrap());
        if let Some(existing) = existing {
            self.key_data = Some(existing);
            return Ok(());
        }

        Ok(())
    }

    // Namespaced to the currently logged-in user
    pub fn new() -> Result<Self, Error> {
        let mut me = Self {
            user: current_user()?,
            key_data: None,
        };

        me.load()?;

        if me.key_data.is_some() {
            Ok(me)
        } else {
            me.key_data = Some(KeyData {
                past_keys: vec![],
                current_key: AsymKey::new(),
            });
            me.save();
            Ok(me)
        }
    }

    pub fn pubkey(&self) -> Vec<u8> {
        self.key_data
            .as_ref()
            .unwrap()
            .current_key
            .public_key()
            .serialize()
            .to_vec()
    }

    // Rotate to a new asymmetric key
    // Returns the new public key
    pub fn rotate(&mut self) -> Vec<u8> {
        let key_data = self.key_data.as_mut().unwrap();
        let new_key = AsymKey::new();
        let pubkey = new_key.public_key().serialize().to_vec();
        key_data.past_keys.push(key_data.current_key.clone());
        key_data.current_key = new_key;
        self.save();

        // TODO: publish new pubkey

        pubkey
    }

    // Decrypts a message using the asymmetric keys of the currently logged-in user
    // Returns the decrypted message or an error if the message cannot be decrypted
    // Will try up to ten of the user's prior keys.
    pub fn decrypt(&mut self, cipher: &[u8]) -> Result<Vec<u8>, Error> {
        let key_data = self.key_data.as_mut().unwrap();

        // Try with current key first
        if let Ok(decrypted_key) = ecies::decrypt(&key_data.current_key.private_key, cipher) {
            key_data.current_key.last_used = Some(get_current_time());
            self.save();
            return Ok(decrypted_key);
        }

        // Try with the 10 most recent past keys
        for key in key_data.past_keys.iter_mut().rev().take(10) {
            if let Ok(decrypted_key) = ecies::decrypt(&key.private_key, cipher) {
                key.last_used = Some(get_current_time());
                self.save();
                return Ok(decrypted_key);
            }
        }

        Err(ErrorType::DecryptionFailed.into())
    }
}

//// Evaluations

#[derive(Pack, Unpack, Debug, Default)]
pub struct EvaluationData {
    num_options: u8,
    groups: Option<Vec<EvalGroup>>,
}

pub struct EvaluationTable {
    owner: AccountNumber,
    id: u32,
    data: EvaluationData,
}

impl EvaluationTable {
    fn primary_key(&self) -> String {
        format!("eval_{}_{}", self.owner, self.id)
    }

    fn last_group(&self) -> &EvalGroup {
        self.data.groups.as_ref().unwrap().last().unwrap()
    }

    fn last_group_mut(&mut self) -> &mut EvalGroup {
        self.data.groups.as_mut().unwrap().last_mut().unwrap()
    }

    pub fn new(owner: AccountNumber, id: u32) -> Result<Self, Error> {
        let mut me = Self {
            owner,
            id,
            data: EvaluationData::default(),
        };

        me.load()?;

        Ok(me)
    }

    // Gets an evaluation group.
    // The group returned by this function is a valid group with members.
    pub fn get_group(&mut self, group_id: u32) -> Result<&mut EvalGroup, Error> {
        // Shortcircuit when group is already fully loaded (including symmetric key)
        if let Some(groups) = &self.data.groups {
            let group_index = groups.iter().position(|g| g.group_id == group_id);

            if let Some(index) = group_index {
                let group = &groups[index];
                if group.key_decrypt_info.is_some() {
                    // All the details for a group have been previously loaded
                    return Ok(&mut self.data.groups.as_mut().unwrap()[index]);
                }
            }
        }

        // Group has not yet been (fully) loaded
        // Fetch group details
        let new_group = fetch_group_details(self.owner, self.id, group_id)?;
        if let Some(groups) = &mut self.data.groups {
            groups.push(new_group);
        } else {
            self.data.groups = Some(vec![new_group]);
        }
        self.save();

        // If a KDF password has already been shared, then we just need to decrypt it
        //   so we can use the shared symmetric key for this eval group.
        let group = self.last_group();

        // Short circuit if there's no password to decrypt
        if !group.key_decrypt_info.is_some() {
            return Ok(self.last_group_mut());
        }

        // Otherwise, decrypt the password and save it
        let cipher = group.get_user_cipher(&current_user()?.to_string())?.clone();
        let kdf_password: [u8; 32] = AsymKeysTable::new()?.decrypt(&cipher)?.try_into().unwrap();

        let group = self.last_group_mut();
        let key_details = group.key_decrypt_info.as_ref().unwrap();

        group.sym_key_password = Some(SymmetricKeyPassword::new(
            kdf_password,
            key_details.salt.clone(),
            key_details.key_hash.clone(),
        )?);

        self.save();
        Ok(self.last_group_mut())
    }

    pub fn register(&mut self) -> Result<(), Error> {
        add_action_to_transaction(
            Actions::register::ACTION_NAME,
            &Actions::register {
                owner: self.owner,
                evaluation_id: self.id,
                registrant: current_user()?,
            }
            .packed(),
        )
    }

    pub fn unregister(&mut self) -> Result<(), Error> {
        add_action_to_transaction(
            Actions::unregister::ACTION_NAME,
            &Actions::unregister {
                owner: self.owner,
                evaluation_id: self.id,
                registrant: current_user()?,
            }
            .packed(),
        )
    }

    fn save(&self) {
        Keyvalue::set(&self.primary_key(), &self.data.packed()).unwrap();
    }

    fn load(&mut self) -> Result<(), Error> {
        let existing = Keyvalue::get(&self.primary_key())
            .map(|value| <EvaluationData>::unpacked(&value).unwrap());

        if existing.is_some() {
            self.data = existing.unwrap();
            return Ok(());
        }

        let eval = crate::graphql::fetch_eval(self.owner, self.id)?;
        if eval.details.is_none() {
            return Err(ErrorType::EvaluationNotFound.into());
        }
        self.data.num_options = eval.details.as_ref().unwrap().num_options;
        self.save();

        Ok(())
    }

    // TODO delete me
    // pub fn set_key(&mut self, password: [u8; 32], salt: Vec<u8>) {
    //     self.data.encryption_key = Some(SymmetricKeyPassword::new(password, salt));
    //     self.save();
    // }

    // TODO delete me
    // pub fn data(&self) -> &EvaluationData {
    //     &self.data
    // }
}
