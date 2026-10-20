use crate::bindings::host::auth::api as HostAuth;
use crate::bindings::host::db::store::{Bucket, Database, DbMode, StorageDuration};
use crate::bindings::host::types::types::Error;
use crate::bindings::transact::query_auth::api as QueryAuth;
use psibase::fracpack::{Pack, Unpack};

// Accounts connected to each app; persistent so connections survive sessions
pub(crate) fn connected_accounts_table() -> Bucket {
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
    pub(crate) fn add(&mut self, account: &str) {
        if self.accounts.contains(&account.to_string()) {
            return;
        }

        self.accounts.push(account.to_string());
    }

    pub(crate) fn remove(&mut self, account: &str) {
        if let Some(idx) = self.accounts.iter().position(|a| a.as_str() == account) {
            self.accounts.swap_remove(idx);
        }
    }
}

// A database with a separate namespace for each app within the `host` namespace
pub struct AppsTable {
    app: String,
}
impl AppsTable {
    pub(crate) fn new(app: &str) -> Self {
        Self {
            app: app.to_string(),
        }
    }

    pub(crate) fn login(&self, user: &str) -> Result<(), Error> {
        self.connect(user);

        let token = if HostAuth::has_query_token(user, &self.app) {
            None
        } else {
            Some(QueryAuth::get_query_token(&self.app, user)?)
        };

        HostAuth::set_logged_in_user(user, &self.app, token.as_deref())
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

        if HostAuth::get_logged_in_user(&self.app).is_some_and(|logged_in| logged_in == user) {
            self.logout();
        }

        connected_accounts_table().set(&self.app, &connected_accounts.packed());
    }

    pub(crate) fn logout(&self) {
        HostAuth::log_out_user(&self.app);
    }

    pub(crate) fn get_connected_accounts(&self) -> Vec<String> {
        let connected_accounts = connected_accounts_table().get(&self.app);
        connected_accounts
            .map(|c| <ConnectedAccounts>::unpacked(&c).unwrap())
            .unwrap_or_default()
            .accounts
    }
}
