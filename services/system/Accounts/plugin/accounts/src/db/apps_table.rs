use crate::bindings::{
    accounts::plugin::types::AppDetails, clientdata::plugin::keyvalue as Keyvalue,
};
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
    app: AppDetails,
}
impl AppsTable {
    pub fn new(app: &AppDetails) -> Self {
        Self { app: app.clone() }
    }

    fn prefix(&self) -> String {
        // App data is namespaced by protocol/port because plugins
        //  are loaded on the same protocol that the supervisor uses.
        //  e.g. https supervisor will load https plugins and store
        //  https data.

        // Only allow storing data for recognized psibase apps, for now
        self.app
            .app
            .clone()
            .expect("Only psibase apps may have entries in accounts table")
    }

    fn prefixed_key(&self, key: &str) -> String {
        self.prefix() + "." + key
    }

    pub fn get_logged_in_user(&self) -> Option<String> {
        Keyvalue::get(&self.prefixed_key(DbKeys::LOGGED_IN)).map(|a| String::from_utf8(a).unwrap())
    }

    pub fn login(&self, user: &str) {
        Keyvalue::set(&self.prefixed_key(DbKeys::LOGGED_IN), user.as_bytes())
            .expect("Failed to set logged-in user");

        // Add to connected accounts if not already present
        let connected_accounts = Keyvalue::get(&self.prefixed_key(DbKeys::CONNECTED_ACCOUNTS));
        let mut connected_accounts = connected_accounts
            .map(|c| <ConnectedAccounts>::unpacked(&c).unwrap())
            .unwrap_or_default();
        connected_accounts.add(user);

        Keyvalue::set(
            &self.prefixed_key(DbKeys::CONNECTED_ACCOUNTS),
            &connected_accounts.packed(),
        )
        .expect("Failed to set connected accounts");
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
