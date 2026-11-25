use crate::bindings::host::auth::api as HostAuth;
use crate::bindings::host::db::store::{Bucket, Database, DbMode, StorageDuration};
use crate::bindings::host::types::types::Error;


// User logged into each app; persistent so the login survives page loads
pub(crate) fn logged_in_user_table() -> Bucket {
    Bucket::new(
        Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        },
        "logged_in_user",
    )
}

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

#[derive(Default, psio::PsszPack, psio::PsszUnpack, psio::ToPsszSchema, psio::JsonText)]
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

    pub(crate) fn get_logged_in_user(&self) -> Option<String> {
        logged_in_user_table()
            .get(&self.app)
            .map(|a| String::from_utf8(a).unwrap())
    }

    pub(crate) fn login(&self, user: &str) -> Result<(), Error> {
        // Get the user's query token and set the app's cookie before recording
        // the login, so that a failure (or a trap) in there leaves the app with
        // whoever was logged in before rather than with a user that has no token.
        HostAuth::set_logged_in_user(user, &self.app)?;

        logged_in_user_table().set(&self.app, user.as_bytes());
        self.connect(user);
        Ok(())
    }

    pub(crate) fn connect(&self, user: &str) {
        let connected_accounts = connected_accounts_table().get(&self.app);
        let mut connected_accounts = connected_accounts
            .map(|c| psio::from_pssz::<ConnectedAccounts>(&c).unwrap())
            .unwrap_or_default();
        connected_accounts.add(user);

        connected_accounts_table().set(&self.app, &psio::to_pssz(&connected_accounts));
    }

    pub(crate) fn disconnect(&self, user: &str) {
        let connected_accounts = connected_accounts_table().get(&self.app);
        let mut connected_accounts = connected_accounts
            .map(|c| psio::from_pssz::<ConnectedAccounts>(&c).unwrap())
            .unwrap_or_default();
        connected_accounts.remove(user);

        if self
            .get_logged_in_user()
            .is_some_and(|logged_in_user| logged_in_user == user)
        {
            self.logout();
        }

        connected_accounts_table().set(&self.app, &psio::to_pssz(&connected_accounts));
    }

    pub(crate) fn logout(&self) {
        if let Some(user) = self.get_logged_in_user() {
            HostAuth::log_out_user(&user, &self.app);
        }
        logged_in_user_table().delete(&self.app);
    }

    pub(crate) fn get_connected_accounts(&self) -> Vec<String> {
        let connected_accounts = connected_accounts_table().get(&self.app);
        connected_accounts
            .map(|c| psio::from_pssz::<ConnectedAccounts>(&c).unwrap())
            .unwrap_or_default()
            .accounts
    }
}
