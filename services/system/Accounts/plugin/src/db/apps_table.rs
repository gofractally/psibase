use crate::bindings::{
    accounts::plugin::types::AppDetails, clientdata::plugin::keyvalue as Keyvalue,
};
use base64::{engine::general_purpose::URL_SAFE, Engine};
use psibase::fracpack::{Pack, Unpack};
use url::Url;

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

#[derive(Pack, Unpack, Default)]
struct ConnectedApps {
    apps: Vec<String>,
}

impl ConnectedApps {
    pub fn add(&mut self, app: &AppDetails) {
        let app = app.app.as_ref();

        if app.is_none() {
            return;
        }

        let app = app.unwrap();

        if self.apps.contains(app) {
            return;
        }

        self.apps.push(app.clone());
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
        // App data is already namespaced by protocol because plugins
        //  are loaded on the same protocol that the supervisor uses.
        //  e.g. https supervisor will load https plugins and store
        //  https data.
        let url = Url::parse(&self.app.origin).unwrap();
        let mut origin = url.domain().unwrap().to_string();
        if let Some(port) = url.port() {
            origin += ":";
            origin += &port.to_string();
        }

        // Encode the origin as base64, URL_SAFE character set
        URL_SAFE.encode(origin)
    }

    fn prefixed_key(&self, key: &str) -> String {
        self.prefix() + "." + key
    }

    pub fn get_logged_in_user(&self) -> Option<String> {
        Keyvalue::get(&self.prefixed_key(DbKeys::LOGGED_IN)).map(|a| String::from_utf8(a).unwrap())
    }

    pub fn login(&self, user: String) {
        Keyvalue::set(&self.prefixed_key(DbKeys::LOGGED_IN), &user.as_bytes())
            .expect("Failed to set logged-in user");

        // Add to connected accounts if not already present
        let connected_accounts = Keyvalue::get(&self.prefixed_key(DbKeys::CONNECTED_ACCOUNTS));
        let mut connected_accounts = connected_accounts
            .map(|c| <ConnectedAccounts>::unpacked(&c).unwrap())
            .unwrap_or_default();
        connected_accounts.add(&user);

        // Add to connected apps if not already present
        let connected_apps = Keyvalue::get(&DbKeys::CONNECTED_APPS);
        let mut connected_apps = connected_apps
            .map(|c| <ConnectedApps>::unpacked(&c).unwrap())
            .unwrap_or_default();
        connected_apps.add(&self.app);
        Keyvalue::set(&DbKeys::CONNECTED_APPS, &connected_apps.packed())
            .expect("Failed to set connected apps");

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

    pub fn get_connected_apps() -> Vec<String> {
        let connected_apps = Keyvalue::get(&DbKeys::CONNECTED_APPS);
        connected_apps
            .map(|c| <ConnectedApps>::unpacked(&c).unwrap())
            .unwrap_or_default()
            .apps
    }
}
