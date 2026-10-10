#[allow(warnings)]
mod bindings;

mod db;
mod errors;
mod helpers;
mod import;
use db::{apps_table::AppsTable, user_table::UserTable};
/// App id for Host plugins and UI (no on-chain service).
pub(crate) const HOST_APP: &str = "host";
use errors::ErrorType::NotConnected;
use helpers::*;

use bindings::exports::host::accounts::active_app::Guest as ActiveApp;
use bindings::exports::host::accounts::admin::{Credential, Guest as Admin};
use bindings::exports::host::accounts::api::Guest as API;
use bindings::host::client::api as Client;
use bindings::host::prompt::api as Prompt;
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

impl ActiveApp for HostAccounts {
    fn login(user: String) -> Result<(), Error> {
        let app = get_assert_top_level_app("login", &[])?;

        if app != Client::get_receiver()
            && !UserTable::new(&user).get_connected_apps().contains(&app)
        {
            return Err(NotConnected(user).into());
        }

        AppsTable::new(&app).login(&user)
    }

    fn logout() -> Result<(), Error> {
        let app = get_assert_top_level_app("logout", &["supervisor"])?;
        AppsTable::new(&app).logout();
        Ok(())
    }

    fn disconnect(account: String) -> Result<(), Error> {
        let app = get_assert_top_level_app("disconnect", &[Client::get_receiver().as_str()])?;
        let apps_table = AppsTable::new(&app);

        if apps_table.get_connected_accounts().contains(&account) {
            apps_table.disconnect(&account);
        }
        Ok(())
    }

    fn get_connected_accounts() -> Result<Vec<String>, Error> {
        let app = get_assert_top_level_app("get_connected_accounts", &["supervisor"])?;
        Ok(AppsTable::new(&app).get_connected_accounts())
    }

    fn connect_account() -> Result<(), Error> {
        get_assert_top_level_app("connect_account", &[])?;

        Prompt::prompt("connect", None);

        Ok(())
    }
}

impl Admin for HostAccounts {
    fn import_existing(credentials: Vec<Credential>) -> Result<(), Vec<(String, Error)>> {
        check_caller(
            &[HOST_APP, "homepage"],
            "import-existing@host:accounts/admin",
        );
        import::import_existing(credentials)
    }

    fn login(user: String, app: String) -> Result<(), Error> {
        check_caller(&[HOST_APP], "login@host:accounts/admin");
        AppsTable::new(&app).login(&user)
    }

    fn logout(app: String) {
        check_caller(&[HOST_APP], "logout@host:accounts/admin");
        AppsTable::new(&app).logout();
    }

    fn connect(account: String, app: String) {
        check_caller(&[HOST_APP], "connect@host:accounts/admin");
        AppsTable::new(&app).connect(&account);
    }

    fn disconnect(account: String, app: String) {
        check_caller(
            &["accounts", HOST_APP],
            "disconnect@host:accounts/admin",
        );
        AppsTable::new(&app).disconnect(&account);
    }

    fn get_connected_accounts(app: String) -> Vec<String> {
        check_caller(
            &["accounts", HOST_APP],
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
