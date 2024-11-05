use crate::bindings::exports::accounts::plugin::active_app::{Guest as ActiveApp, *};
use crate::bindings::exports::accounts::plugin::api::Guest;
use crate::bindings::host::common::client as Client;
use crate::db::*;
use crate::errors::ErrorType::*;
use crate::helpers::*;
use crate::plugin::AccountsPlugin;

impl ActiveApp for AccountsPlugin {
    fn login(user: String) -> Result<(), Error> {
        let account_details =
            AccountsPlugin::get_account(user.clone()).expect("Get account failed");
        if account_details.is_none() {
            return Err(InvalidAccountName.err("Invalid account name"));
        }

        let app_domain = get_assert_top_level_app("login", &vec![])?;
        AppsTable::new(app_domain).login(user);
        Ok(())
    }

    fn logout() -> Result<(), Error> {
        let app_domain = get_assert_top_level_app("logout", &vec!["supervisor"])?;
        AppsTable::new(app_domain).logout();
        Ok(())
    }

    fn get_logged_in_user() -> Result<Option<String>, Error> {
        let app_domain =
            get_assert_top_level_app("get_logged_in_user", &vec!["supervisor", "transact"])?;
        Ok(AppsTable::new(app_domain).get_logged_in_user())
    }

    fn get_connected_accounts() -> Result<Vec<String>, Error> {
        let app_domain = get_assert_top_level_app("get_available_accounts", &vec!["supervisor"])?;
        Ok(AppsTable::new(app_domain).get_connected_accounts())
    }

    fn create_connection_token() -> Result<String, Error> {
        let app_domain = get_assert_top_level_app("get_connection_token", &vec![])?;
        Ok(TokensTable::new().add_connection_token(&app_domain, Client::get_sender_app().app))
    }
}
