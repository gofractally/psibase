use crate::bindings::accounts::account_tokens::types::*;
use crate::bindings::exports::accounts::plugin::active_app::{Guest as ActiveApp, *};
use crate::bindings::exports::accounts::plugin::api::Guest;
use crate::db::apps_table::*;
use crate::db::user_table::*;
use crate::errors::ErrorType::*;
use crate::helpers::*;
use crate::plugin::AccountsPlugin;

impl ActiveApp for AccountsPlugin {
    fn login(user: String) -> Result<(), Error> {
        let account_details =
            AccountsPlugin::get_account(user.clone()).expect("Get account failed");
        if account_details.is_none() {
            return Err(InvalidAccountName(user).into());
        }

        let app = get_assert_top_level_app("login", &vec![])?;

        if app.app.is_none() {
            let msg = format!("Unrecognized app: {}", app.origin);
            return Err(InvalidApp(msg).into());
        }

        AppsTable::new(&app).login(&user);
        UserTable::new(&user).add_connected_app(&app);
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
        let app = get_assert_top_level_app("get_connected_accounts", &vec!["supervisor"])?;
        Ok(AppsTable::new(&app).get_connected_accounts())
    }

    fn create_connection_token() -> Result<String, Error> {
        let app = get_assert_top_level_app("create_connection_token", &vec![])?;
        Ok(Token::new_connection_token(app).into())
    }
}
