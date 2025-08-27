use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;
use psibase::fracpack::{Pack, Unpack};

use crate::db::keys::DbKeys;

#[derive(Pack, Unpack, Default)]
struct ConnectedAccounts {
    accounts: Vec<String>,
}

impl ConnectedAccounts {
    pub fn add(&mut self, account: &str) {
        if self.accounts.contains(&account.to_string()) {
            return;
        }

        self.accounts.push(account.to_string());
    }
}

// A database with a separate namespace for each app within the `accounts` namespace
pub struct AppsTable {
    app: String,
}
impl AppsTable {
    pub fn new(app: &String) -> Self {
        Self { app: app.clone() }
    }

    fn prefix(&self) -> String {
        self.app.clone()
    }

    fn prefixed_key(&self, key: &str) -> String {
        self.prefix() + "." + key
    }

    pub fn get_logged_in_user(&self) -> Option<String> {
        Keyvalue::get(&self.prefixed_key(DbKeys::LOGGED_IN)).map(|a| String::from_utf8(a).unwrap())
    }

    pub fn login(&self, user: &str) {
        Keyvalue::set(&self.prefixed_key(DbKeys::LOGGED_IN), user.as_bytes());

        self.connect(user);
    }

    pub fn connect(&self, user: &str) {
        let connected_accounts = Keyvalue::get(&self.prefixed_key(DbKeys::CONNECTED_ACCOUNTS));
        let mut connected_accounts = connected_accounts
            .map(|c| <ConnectedAccounts>::unpacked(&c).unwrap())
            .unwrap_or_default();
        connected_accounts.add(user);

        Keyvalue::set(
            &self.prefixed_key(DbKeys::CONNECTED_ACCOUNTS),
            &connected_accounts.packed(),
        );
    }

    pub fn logout(&self) {
        Keyvalue::delete(&self.prefixed_key(DbKeys::LOGGED_IN));
    }

    pub fn get_connected_accounts(&self) -> Vec<String> {
        let connected_accounts = Keyvalue::get(&self.prefixed_key(DbKeys::CONNECTED_ACCOUNTS));
        connected_accounts
            .map(|c| <ConnectedAccounts>::unpacked(&c).unwrap())
            .unwrap_or_default()
            .accounts
    }
}
