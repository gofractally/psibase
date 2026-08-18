#[allow(warnings)]
mod bindings;
#[path = "../../shared/logged_in_user_table.rs"]
mod logged_in_user;

use bindings::exports::accounts::client_query::api::Guest as API;
use bindings::host::client::api as Client;
use logged_in_user::logged_in_user_table;

struct AccountsCurrentUser;

impl API for AccountsCurrentUser {
    fn is_logged_in() -> bool {
        Self::get_current_user().is_some()
    }

    fn get_current_user() -> Option<String> {
        logged_in_user_table()
            .get(&Client::get_active_app())
            .map(|a| String::from_utf8(a).unwrap())
    }
}

bindings::export!(AccountsCurrentUser with_types_in bindings);
