#[allow(warnings)]
mod bindings;

mod db;
mod errors;
mod helpers;
use db::{apps_table::AppsTable, user_table::UserTable};
use errors::ErrorType::NotConnected;
use helpers::*;

use bindings::exports::host::session::active_app::Guest as ActiveApp;
use bindings::exports::host::session::admin::Guest as Admin;
use bindings::exports::host::session::api::Guest as API;
use bindings::host::client::api as Client;
use bindings::host::prompt::api as Prompt;
use bindings::host::types::types::Error;

struct HostSession;

impl API for HostSession {
    fn is_logged_in() -> bool {
        Self::get_current_user().is_some()
    }

    fn get_current_user() -> Option<String> {
        AppsTable::new(&Client::get_active_app()).get_logged_in_user()
    }
}

impl ActiveApp for HostSession {
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

impl Admin for HostSession {
    fn login(user: String, app: String) -> Result<(), Error> {
        check_caller(&["accounts", "host"], "login@host:session/admin");
        AppsTable::new(&app).login(&user)
    }

    fn logout(app: String) {
        check_caller(&["accounts", "host"], "logout@host:session/admin");
        AppsTable::new(&app).logout();
    }

    fn connect(account: String, app: String) {
        check_caller(&["accounts", "host"], "connect@host:session/admin");
        AppsTable::new(&app).connect(&account);
    }

    fn disconnect(account: String, app: String) {
        check_caller(&["accounts", "host"], "disconnect@host:session/admin");
        AppsTable::new(&app).disconnect(&account);
    }

    fn get_connected_accounts(app: String) -> Vec<String> {
        check_caller(
            &["accounts", "host"],
            "get-connected-accounts@host:session/admin",
        );
        AppsTable::new(&app).get_connected_accounts()
    }

    fn add_connected_app(user: String, app: String) {
        check_caller(
            &["accounts", "host"],
            "add-connected-app@host:session/admin",
        );
        UserTable::new(&user).add_connected_app(&app);
    }

    fn remove_connected_app(user: String, app: String) {
        check_caller(
            &["accounts", "host"],
            "remove-connected-app@host:session/admin",
        );
        UserTable::new(&user).remove_connected_app(&app);
    }

    fn get_connected_apps(user: String) -> Vec<String> {
        check_caller(
            &["accounts", "host"],
            "get-connected-apps@host:session/admin",
        );
        UserTable::new(&user).get_connected_apps()
    }
}

bindings::export!(HostSession with_types_in bindings);
