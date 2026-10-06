use crate::bindings::host::accounts::api as HostAccounts;
use crate::bindings::host::auth::api as HostAuth;
use crate::bindings::host::db::store::{Bucket, Database, DbMode, StorageDuration};
use psibase::fracpack::{Pack, Unpack};

fn connected_accounts_table() -> Bucket {
    Bucket::new(
        Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        },
        "connected_accounts",
    )
}

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

    pub fn remove(&mut self, account: &str) {
        if let Some(idx) = self.accounts.iter().position(|a| a.as_str() == account) {
            self.accounts.swap_remove(idx);
        }
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

    pub fn login(&self, user: &str) {
        HostAccounts::set_current_user(user, &self.app);
        self.connect(user);
    }

    pub fn connect(&self, user: &str) {
        let connected_accounts = connected_accounts_table().get(&self.app);
        let mut connected_accounts = connected_accounts
            .map(|c| <ConnectedAccounts>::unpacked(&c).unwrap())
            .unwrap_or_default();
        connected_accounts.add(user);

        connected_accounts_table().set(&self.app, &connected_accounts.packed());
    }

    pub fn disconnect(&self, user: &str) {
        let connected_accounts = connected_accounts_table().get(&self.app);
        let mut connected_accounts = connected_accounts
            .map(|c| <ConnectedAccounts>::unpacked(&c).unwrap())
            .unwrap_or_default();
        connected_accounts.remove(user);

        if HostAccounts::revoke_login(user, &self.app) {
            HostAuth::log_out_user(user, &self.app);
        }

        connected_accounts_table().set(&self.app, &connected_accounts.packed());
    }

    pub fn logout(&self) {
        if let Some(user) = HostAccounts::clear_current_user(&self.app) {
            HostAuth::log_out_user(&user, &self.app);
        }
    }

    pub fn get_connected_accounts(&self) -> Vec<String> {
        let connected_accounts = connected_accounts_table().get(&self.app);
        connected_accounts
            .map(|c| <ConnectedAccounts>::unpacked(&c).unwrap())
            .unwrap_or_default()
            .accounts
    }
}
