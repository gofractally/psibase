use crate::bindings::host::auth::api as HostAuth;
use crate::bindings::host::db::store::{Bucket, Database, DbMode, StorageDuration};
use psibase::fracpack::{Pack, Unpack};

fn logged_in_user_table() -> Bucket {
    Bucket::new(
        Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        },
        "logged_in_user",
    )
}

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

    pub fn get_logged_in_user(&self) -> Option<String> {
        logged_in_user_table()
            .get(&self.app)
            .map(|a| String::from_utf8(a).unwrap())
    }

    pub fn login(&self, user: &str) {
        logged_in_user_table().set(&self.app, user.as_bytes());

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

        if self
            .get_logged_in_user()
            .is_some_and(|logged_in_user| logged_in_user == user)
        {
            self.logout();
        }

        connected_accounts_table().set(&self.app, &connected_accounts.packed());
    }

    pub fn logout(&self) {
        if let Some(user) = self.get_logged_in_user() {
            HostAuth::end_session(&user, &self.app);
        }
        logged_in_user_table().delete(&self.app);
    }

    pub fn get_connected_accounts(&self) -> Vec<String> {
        let connected_accounts = connected_accounts_table().get(&self.app);
        connected_accounts
            .map(|c| <ConnectedAccounts>::unpacked(&c).unwrap())
            .unwrap_or_default()
            .accounts
    }
}
