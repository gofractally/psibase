#[allow(warnings)]
mod bindings;

mod helpers;
use helpers::*;

use bindings::exports::host::accounts::api::Guest as API;
use bindings::host::client::api as Client;
use bindings::host::db::store::{Bucket, Database, DbMode, StorageDuration};

struct HostAccounts;

fn logged_in_user_table() -> Bucket {
    Bucket::new(
        Database {
            mode: DbMode::NonTransactional,
            duration: StorageDuration::Persistent,
        },
        "logged_in_user",
    )
}

fn user_for_app(app: &str) -> Option<String> {
    logged_in_user_table()
        .get(app)
        .map(|a| String::from_utf8(a).unwrap())
}

impl API for HostAccounts {
    fn is_logged_in() -> bool {
        Self::get_current_user().is_some()
    }

    fn get_current_user() -> Option<String> {
        user_for_app(&Client::get_active_app())
    }

    fn set_current_user(user: String, app: String) {
        check_caller(&["accounts"], "set-current-user@host:accounts/api");
        logged_in_user_table().set(&app, user.as_bytes());
    }

    fn clear_current_user(app: String) -> Option<String> {
        check_caller(&["accounts"], "clear-current-user@host:accounts/api");
        let user = user_for_app(&app)?;
        logged_in_user_table().delete(&app);
        Some(user)
    }

    fn revoke_login(user: String, app: String) -> bool {
        check_caller(&["accounts"], "revoke-login@host:accounts/api");
        match user_for_app(&app) {
            Some(current) if current == user => {
                logged_in_user_table().delete(&app);
                true
            }
            _ => false,
        }
    }
}

bindings::export!(HostAccounts with_types_in bindings);
