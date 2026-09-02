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
}

// Same host:db namespace as accounts:plugin — Bucket keys by get_sender() service.
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

    pub fn connect(&self, user: &str) {
        let connected_accounts = connected_accounts_table().get(&self.app);
        let mut connected_accounts = connected_accounts
            .map(|c| <ConnectedAccounts>::unpacked(&c).unwrap())
            .unwrap_or_default();
        connected_accounts.add(user);

        connected_accounts_table().set(&self.app, &connected_accounts.packed());
    }
}
