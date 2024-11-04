use crate::bindings::exports::accounts::plugin::active_app::{Guest as ActiveApp, *};
use crate::bindings::host::common::client as Client;
use crate::db::*;
use crate::helpers::*;
use crate::plugin::AccountsPlugin;

impl ActiveApp for AccountsPlugin {
    fn login(user: String) -> Result<(), Error> {
        let app_domain = get_assert_top_level_app("login", &vec![])?;
        App::new(app_domain).login(user);
        Ok(())
    }

    fn logout() -> Result<(), Error> {
        let app_domain = get_assert_top_level_app("logout", &vec!["supervisor"])?;
        App::new(app_domain).logout();
        Ok(())
    }

    fn get_logged_in_user() -> Result<Option<String>, Error> {
        let app_domain =
            get_assert_top_level_app("get_logged_in_user", &vec!["supervisor", "transact"])?;
        Ok(App::new(app_domain).get_logged_in_user())
    }

    fn get_connected_accounts() -> Result<Vec<String>, Error> {
        let app_domain = get_assert_top_level_app("get_available_accounts", &vec!["supervisor"])?;
        Ok(App::new(app_domain).get_connected_accounts())
    }

    fn create_connection_token() -> Result<String, Error> {
        let app_domain = get_assert_top_level_app("get_connection_token", &vec![])?;
        Ok(Db::new().create_connection_token(&app_domain, Client::get_sender_app().app))
    }
}
