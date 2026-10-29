#[allow(warnings)]
mod bindings;

mod db;
mod errors;
mod helpers;

use db::{apps_table::AppsTable, user_table::UserTable};
use helpers::*;

use bindings::exports::host::accounts::admin::Guest as Admin;
use bindings::exports::host::accounts::api::Guest as Api;
use bindings::host::client::api as Client;
use bindings::host::types::types::Error;

struct HostAccounts;

/// Platform facts about accounts on this device: who is logged into the
/// active app, and which accounts are connected to which apps.
impl Api for HostAccounts {
    fn is_logged_in() -> bool {
        Self::get_current_user().is_some()
    }

    fn get_current_user() -> Option<String> {
        AppsTable::new(&Client::get_active_app()).get_logged_in_user()
    }

    fn get_connected_accounts() -> Result<Vec<String>, Error> {
        let app = get_assert_top_level_app("get_connected_accounts", &["supervisor"])?;
        Ok(AppsTable::new(&app).get_connected_accounts())
    }
}

impl Admin for HostAccounts {
    fn set_current_user(user: String, app: String) {
        check_caller(&[HOST_APP], "set-current-user@host:accounts/admin");
        AppsTable::new(&app).set_logged_in_user(&user);
    }

    fn clear_current_user(app: String) -> Option<String> {
        check_caller(&[HOST_APP], "clear-current-user@host:accounts/admin");
        AppsTable::new(&app).clear_logged_in_user()
    }

    fn revoke_login(user: String, app: String) -> bool {
        check_caller(&[HOST_APP], "revoke-login@host:accounts/admin");
        AppsTable::new(&app).revoke_login(&user)
    }

    fn connect(account: String, app: String) {
        check_caller(&[HOST_APP], "connect@host:accounts/admin");
        AppsTable::new(&app).connect(&account);
    }

    fn disconnect(account: String, app: String) {
        check_caller(&[HOST_APP], "disconnect@host:accounts/admin");
        AppsTable::new(&app).disconnect(&account);
    }

    fn get_connected_accounts(app: String) -> Vec<String> {
        check_caller(
            &[HOST_APP, "accounts"],
            "get-connected-accounts@host:accounts/admin",
        );
        AppsTable::new(&app).get_connected_accounts()
    }

    fn add_connected_app(user: String, app: String) {
        check_caller(&[HOST_APP], "add-connected-app@host:accounts/admin");
        UserTable::new(&user).add_connected_app(&app);
    }

    fn remove_connected_app(user: String, app: String) {
        check_caller(&[HOST_APP], "remove-connected-app@host:accounts/admin");
        UserTable::new(&user).remove_connected_app(&app);
    }

    fn get_connected_apps(user: String) -> Vec<String> {
        check_caller(&[HOST_APP], "get-connected-apps@host:accounts/admin");
        UserTable::new(&user).get_connected_apps()
    }
}

bindings::export!(HostAccounts with_types_in bindings);
