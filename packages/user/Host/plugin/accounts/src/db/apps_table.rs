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

// Accounts connected to each app; persistent so connections survive sessions
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
    fn add(&mut self, account: &str) {
        if self.accounts.contains(&account.to_string()) {
            return;
        }
        self.accounts.push(account.to_string());
    }

    fn remove(&mut self, account: &str) {
        if let Some(idx) = self.accounts.iter().position(|a| a.as_str() == account) {
            self.accounts.swap_remove(idx);
        }
    }
}

/// Per-app current-user and connected-account inventory under the `host` db namespace.
pub struct AppsTable {
    app: String,
}

impl AppsTable {
    pub(crate) fn new(app: &str) -> Self {
        Self {
            app: app.to_string(),
        }
    }

    pub(crate) fn get_logged_in_user(&self) -> Option<String> {
        logged_in_user_table()
            .get(&self.app)
            .map(|a| String::from_utf8(a).unwrap())
    }

    pub(crate) fn set_logged_in_user(&self, user: &str) {
        logged_in_user_table().set(&self.app, user.as_bytes());
    }

    pub(crate) fn clear_logged_in_user(&self) -> Option<String> {
        let user = self.get_logged_in_user();
        if user.is_some() {
            logged_in_user_table().delete(&self.app);
        }
        user
    }

    pub(crate) fn revoke_login(&self, user: &str) -> bool {
        if self.get_logged_in_user().as_deref() == Some(user) {
            logged_in_user_table().delete(&self.app);
            true
        } else {
            false
        }
    }

    pub(crate) fn connect(&self, user: &str) {
        let connected_accounts = connected_accounts_table().get(&self.app);
        let mut connected_accounts = connected_accounts
            .map(|c| <ConnectedAccounts>::unpacked(&c).unwrap())
            .unwrap_or_default();
        connected_accounts.add(user);
        connected_accounts_table().set(&self.app, &connected_accounts.packed());
    }

    pub(crate) fn disconnect(&self, user: &str) {
        let connected_accounts = connected_accounts_table().get(&self.app);
        let mut connected_accounts = connected_accounts
            .map(|c| <ConnectedAccounts>::unpacked(&c).unwrap())
            .unwrap_or_default();
        connected_accounts.remove(user);
        connected_accounts_table().set(&self.app, &connected_accounts.packed());
    }

    pub(crate) fn get_connected_accounts(&self) -> Vec<String> {
        let connected_accounts = connected_accounts_table().get(&self.app);
        connected_accounts
            .map(|c| <ConnectedAccounts>::unpacked(&c).unwrap())
            .unwrap_or_default()
            .accounts
    }
}
