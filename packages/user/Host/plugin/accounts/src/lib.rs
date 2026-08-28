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

impl API for HostAccounts {
    fn is_logged_in() -> bool {
        Self::get_current_user().is_some()
    }

    fn get_current_user() -> Option<String> {
        Self::get_user(Client::get_active_app())
    }

    fn get_user(app: String) -> Option<String> {
        logged_in_user_table()
            .get(&app)
            .map(|a| String::from_utf8(a).unwrap())
    }

    fn set_current_user(user: String, app: String) {
        check_caller(&["accounts"], "set-current-user@host:accounts/api");
        logged_in_user_table().set(&app, user.as_bytes());
    }

    fn clear_current_user(app: String) {
        check_caller(&["accounts"], "clear-current-user@host:accounts/api");
        logged_in_user_table().delete(&app);
    }
}

bindings::export!(HostAccounts with_types_in bindings);
