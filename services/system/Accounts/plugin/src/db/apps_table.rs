use crate::bindings::clientdata::plugin::keyvalue as Keyvalue;
use base64::{engine::general_purpose::URL_SAFE, Engine};
use psibase::fracpack::{Pack, Unpack};
use url::Url;

use crate::db::keys::DbKeys;

#[derive(Pack, Unpack)]
struct ConnectedAccounts {
    accounts: Vec<String>,
}

impl Default for ConnectedAccounts {
    fn default() -> Self {
        Self { accounts: vec![] }
    }
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
    origin: String,
}
impl AppsTable {
    pub fn new(origin: String) -> Self {
        Self { origin }
    }

    fn prefix(&self) -> String {
        // Do not namespace app data by protocol
        let url = Url::parse(&self.origin).unwrap();
        let mut origin = url.domain().unwrap().to_string();
        if let Some(port) = url.port() {
            origin += ":";
            origin += &port.to_string();
        }

        // Encode the origin as base64, URL_SAFE character set
        URL_SAFE.encode(origin)
    }

    fn key(&self, key: &str) -> String {
        self.prefix() + "." + key
    }

    pub fn get_logged_in_user(&self) -> Option<String> {
        Keyvalue::get(&self.key(DbKeys::LOGGED_IN)).map(|a| String::from_utf8(a).unwrap())
    }

    pub fn login(&self, user: String) {
        Keyvalue::set(&self.key(DbKeys::LOGGED_IN), &user.as_bytes())
            .expect("Failed to set logged-in user");

        // Add to connected accounts if not already present
        let connected_accounts = Keyvalue::get(&self.key(DbKeys::CONNECTED_ACCOUNTS));
        let mut connected_accounts = connected_accounts
            .map(|c| {
                <ConnectedAccounts>::unpacked(&c).expect("Failed to unpack connected accounts")
            })
            .unwrap_or_default();

        connected_accounts.add(&user);

        Keyvalue::set(
            &self.key(DbKeys::CONNECTED_ACCOUNTS),
            &connected_accounts.packed(),
        )
        .expect("Failed to set connected accounts");
    }

    pub fn logout(&self) {
        Keyvalue::delete(&self.key(DbKeys::LOGGED_IN));
    }

    pub fn get_connected_accounts(&self) -> Vec<String> {
        let connected_accounts = Keyvalue::get(&self.key(DbKeys::CONNECTED_ACCOUNTS));
        connected_accounts
            .map(|c| {
                <ConnectedAccounts>::unpacked(&c).expect("Failed to unpack connected accounts")
            })
            .unwrap_or_default()
            .accounts
    }
}
