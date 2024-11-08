use crate::bindings::exports::accounts::plugin::active_app::{Guest as ActiveApp, *};
use crate::bindings::exports::accounts::plugin::api::Guest;
use crate::db::apps_table::*;
use crate::errors::ErrorType::*;
use crate::helpers::*;
use crate::plugin::AccountsPlugin;
use crate::tokens::tokens::*;
use base64::{engine::general_purpose::URL_SAFE, Engine};
use psibase::fracpack::Pack;

impl ActiveApp for AccountsPlugin {
    fn login(user: String) -> Result<(), Error> {
        let account_details =
            AccountsPlugin::get_account(user.clone()).expect("Get account failed");
        if account_details.is_none() {
            return Err(InvalidAccountName("Invalid account name".to_string()).into());
        }

        let app = get_assert_top_level_app("login", &vec![])?;
        AppsTable::new(&app).login(user);
        Ok(())
    }

    fn logout() -> Result<(), Error> {
        let app = get_assert_top_level_app("logout", &vec!["supervisor"])?;
        AppsTable::new(&app).logout();
        Ok(())
    }

    fn get_logged_in_user() -> Result<Option<String>, Error> {
        let app = get_assert_top_level_app("get_logged_in_user", &vec!["supervisor", "transact"])?;
        Ok(AppsTable::new(&app).get_logged_in_user())
    }

    fn get_connected_accounts() -> Result<Vec<String>, Error> {
        let app = get_assert_top_level_app("get_available_accounts", &vec!["supervisor"])?;
        Ok(AppsTable::new(&app).get_connected_accounts())
    }

    fn create_connection_token() -> Result<String, Error> {
        let app = get_assert_top_level_app("get_connection_token", &vec![])?;
        Ok(URL_SAFE.encode(&ConnectionToken::new(app).packed()))
    }
}
