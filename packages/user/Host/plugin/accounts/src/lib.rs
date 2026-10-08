#[allow(warnings)]
mod bindings;

mod db;
mod helpers;
use db::{apps_table::AppsTable, user_table::UserTable};
use helpers::*;

use bindings::exports::host::accounts::admin::Guest as Admin;
use bindings::exports::host::accounts::api::Guest as API;
use bindings::host::client::api as Client;
use bindings::host::types::types::Error;

struct HostAccounts;

impl API for HostAccounts {
    fn is_logged_in() -> bool {
        Self::get_current_user().is_some()
    }

    fn get_current_user() -> Option<String> {
        AppsTable::new(&Client::get_active_app()).get_logged_in_user()
    }
}

impl Admin for HostAccounts {
    fn login(user: String, app: String, auth_service: String) -> Result<(), Error> {
        check_caller(&["accounts"], "login@host:accounts/admin");
        AppsTable::new(&app).login(&user, &auth_service)
    }

    fn logout(app: String) {
        check_caller(&["accounts"], "logout@host:accounts/admin");
        AppsTable::new(&app).logout();
    }

    fn connect(account: String, app: String) {
        check_caller(&["accounts"], "connect@host:accounts/admin");
        AppsTable::new(&app).connect(&account);
    }

    fn disconnect(account: String, app: String) {
        check_caller(&["accounts"], "disconnect@host:accounts/admin");
        AppsTable::new(&app).disconnect(&account);
    }

    fn get_connected_accounts(app: String) -> Vec<String> {
        check_caller(&["accounts"], "get-connected-accounts@host:accounts/admin");
        AppsTable::new(&app).get_connected_accounts()
    }

    fn add_connected_app(user: String, app: String) {
        check_caller(&["accounts"], "add-connected-app@host:accounts/admin");
        UserTable::new(&user).add_connected_app(&app);
    }

    fn remove_connected_app(user: String, app: String) {
        check_caller(&["accounts"], "remove-connected-app@host:accounts/admin");
        UserTable::new(&user).remove_connected_app(&app);
    }

    fn get_connected_apps(user: String) -> Vec<String> {
        check_caller(&["accounts"], "get-connected-apps@host:accounts/admin");
        UserTable::new(&user).get_connected_apps()
    }
}

bindings::export!(HostAccounts with_types_in bindings);
