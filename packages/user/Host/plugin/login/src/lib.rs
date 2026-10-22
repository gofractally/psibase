#[allow(warnings)]
mod bindings;

mod errors;
mod helpers;
mod import;
mod session;

use errors::ErrorType::NotConnected;
use helpers::*;

use bindings::exports::host::login::admin::{Credential, Guest as Admin};
use bindings::exports::host::login::api::Guest as Api;
use bindings::host::accounts::admin as HostAccounts;
use bindings::host::client::api as Client;
use bindings::host::prompt::api as Prompt;
use bindings::host::types::types::Error;

struct HostLogin;

/// Login, connect, and import orchestration.
impl Api for HostLogin {
    fn login(user: String) -> Result<(), Error> {
        let app = get_assert_top_level_app("login", &[])?;

        if app != Client::get_receiver() && !HostAccounts::get_connected_apps(&user).contains(&app)
        {
            return Err(NotConnected(user).into());
        }

        session::login(&user, &app)
    }

    fn logout() -> Result<(), Error> {
        let app = get_assert_top_level_app("logout", &["supervisor"])?;
        session::logout(&app);
        Ok(())
    }

    fn disconnect(account: String) -> Result<(), Error> {
        let app = get_assert_top_level_app("disconnect", &[Client::get_receiver().as_str()])?;
        if HostAccounts::get_connected_accounts(&app).contains(&account) {
            session::disconnect(&account, &app);
        }
        Ok(())
    }

    fn connect_account() -> Result<(), Error> {
        get_assert_top_level_app("connect_account", &[])?;
        Prompt::prompt("connect", None);
        Ok(())
    }
}

impl Admin for HostLogin {
    fn import_existing(credentials: Vec<Credential>) -> Result<(), Vec<(String, Error)>> {
        check_caller(&[HOST_APP, "homepage"], "import-existing@host:login/admin");
        import::import_existing(credentials)
    }

    fn login_to_app(user: String, app: String) -> Result<(), Error> {
        check_caller(&[HOST_APP], "login-to-app@host:login/admin");
        session::login(&user, &app)
    }

    fn logout(app: String) {
        check_caller(&[HOST_APP], "logout@host:login/admin");
        session::logout(&app);
    }

    fn connect(account: String, app: String) {
        check_caller(&[HOST_APP], "connect@host:login/admin");
        HostAccounts::connect(&account, &app);
    }

    fn disconnect(account: String, app: String) {
        check_caller(&["accounts", HOST_APP], "disconnect@host:login/admin");
        session::disconnect(&account, &app);
    }

    fn get_connected_accounts(app: String) -> Vec<String> {
        check_caller(
            &["accounts", HOST_APP],
            "get-connected-accounts@host:login/admin",
        );
        HostAccounts::get_connected_accounts(&app)
    }

    fn add_connected_app(user: String, app: String) {
        check_caller(&[HOST_APP], "add-connected-app@host:login/admin");
        HostAccounts::add_connected_app(&user, &app);
    }

    fn remove_connected_app(user: String, app: String) {
        check_caller(&[HOST_APP], "remove-connected-app@host:login/admin");
        HostAccounts::remove_connected_app(&user, &app);
    }

    fn get_connected_apps(user: String) -> Vec<String> {
        check_caller(&[HOST_APP], "get-connected-apps@host:login/admin");
        HostAccounts::get_connected_apps(&user)
    }
}

bindings::export!(HostLogin with_types_in bindings);
