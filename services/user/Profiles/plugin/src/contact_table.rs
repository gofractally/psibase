use std::str::FromStr;

use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;
use psibase::fracpack::{Pack, Unpack};
use psibase::AccountNumber;

use crate::bindings::profiles::plugin::types::Contact;

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

impl From<Contact> for ContactEntry {
    fn from(contact: Contact) -> Self {
        Self {
            account: AccountNumber::from_str(&contact.account.as_str())
                .expect("Invalid account number"),
            nickname: contact.nickname,
            email: contact.email,
            phone: contact.phone,
        }
    }
}

pub struct ContactTable {
    user: AccountNumber,
}

impl ContactTable {
    pub fn new(user: String) -> Self {
        Self {
            user: AccountNumber::from_str(&user).unwrap(),
        }
    }

    fn key(&self) -> String {
        self.user.to_string()
    }

    fn save_contacts(&self, contacts: Vec<ContactEntry>) {
        Keyvalue::set(&self.key(), &contacts.packed());
    }

    pub fn set(&self, contact: Contact, overwrite: bool) -> Result<(), Error> {
        let contact = ContactEntry::from(contact);
        let mut contacts = self.get_contacts();

        match contacts.iter().position(|c| c.account == contact.account) {
            Some(index) => {
                if overwrite {
                    contacts[index] = contact;
                } else {
                    return Err(ErrorType::ContactAlreadyExists(contact.account.to_string()).into());
                }
            }
            None => contacts.push(contact),
        }
        self.save_contacts(contacts);
        Ok(())
    }

    pub fn get_contacts(&self) -> Vec<ContactEntry> {
        let contacts = Keyvalue::get(&self.key());

        contacts
            .map(|c| <Vec<ContactEntry>>::unpacked(&c).unwrap())
            .unwrap_or_default()
    }

    pub fn remove(&self, account: &str) -> Result<(), Error> {
        let mut contacts = self.get_contacts();

        let account_number = AccountNumber::from_str(&account)
            .map_err(|_| ErrorType::InvalidAccountNumber(account.to_string()))?;

        match contacts.iter().position(|c| c.account == account_number) {
            Some(index) => {
                contacts.remove(index);
                self.save_contacts(contacts);
                Ok(())
            }
            None => Err(ErrorType::ContactNotFound(account.to_string()).into()),
        }
    }
}
