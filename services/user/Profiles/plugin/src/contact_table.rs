pub const CONTACTS_KEY: &str = "contacts";

use std::str::FromStr;

use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;
use psibase::fracpack::{Pack, Unpack};
use psibase::AccountNumber;

use crate::bindings::host::common::types::Error;

use crate::errors;
use errors::ErrorType;

#[derive(Pack, Unpack, Debug, Default)]
pub struct ContactEntry {
    pub account: AccountNumber,
    pub nickname: Option<String>,
    pub email: Option<String>,
    pub phone: Option<String>,
}

impl ContactEntry {
    pub fn new(
        account: String,
        nickname: Option<String>,
        email: Option<String>,
        phone: Option<String>,
    ) -> Self {
        Self {
            account: AccountNumber::from_str(&account).expect("Invalid account number"),
            nickname,
            email,
            phone,
        }
    }
}

pub struct ContactTable {
    user: AccountNumber,
}

impl ContactTable {
    pub fn new(user: AccountNumber) -> Self {
        Self { user }
    }

    fn key(&self) -> String {
        CONTACTS_KEY.to_string() + "." + &self.user.to_string()
    }

    pub fn add(&self, contact: ContactEntry) -> Result<(), Error> {
        let mut contacts = self.get_contacts();

        let already_exists = contacts.iter().any(|c| c.account == contact.account);
        if already_exists {
            return Err(ErrorType::ContactAlreadyExists(contact.account.to_string()).into());
        }

        contacts.push(contact);
        self.save_contacts(contacts)
    }

    pub fn get_contacts(&self) -> Vec<ContactEntry> {
        let contacts = Keyvalue::get(&self.key());

        contacts
            .map(|c| <Vec<ContactEntry>>::unpacked(&c).unwrap())
            .unwrap_or_default()
    }

    pub fn save_contacts(&self, contacts: Vec<ContactEntry>) -> Result<(), Error> {
        Keyvalue::set(&self.key(), &contacts.packed())
    }

    pub fn update_contact(&self, contact: ContactEntry) -> Result<(), Error> {
        let mut contacts = self.get_contacts();

        match contacts.iter().position(|c| c.account == contact.account) {
            Some(index) => {
                contacts[index] = contact;
                self.save_contacts(contacts)
            }
            None => Err(ErrorType::ContactNotFound(contact.account.to_string()).into()),
        }
    }

    pub fn remove(&self, account: AccountNumber) -> Result<(), Error> {
        let mut contacts = self.get_contacts();

        match contacts.iter().position(|c| c.account == account) {
            Some(index) => {
                contacts.remove(index);
                self.save_contacts(contacts)
            }
            None => Err(ErrorType::ContactNotFound(account.to_string()).into()),
        }
    }
}
