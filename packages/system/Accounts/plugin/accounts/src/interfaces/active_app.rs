use crate::bindings::host::auth::api as HostAuth;
use crate::bindings::*;
use crate::db::apps_table::*;
use crate::db::user_table::*;
use crate::errors::ErrorType::*;
use crate::helpers::*;
use crate::plugin::AccountsPlugin;
use accounts::account_tokens::types::*;
use exports::accounts::plugin::{
    active_app::{Guest as ActiveApp, *},
    api::Guest,
};
use host::common::client::get_app_url;

impl ActiveApp for AccountsPlugin {
    fn login(user: String) -> Result<(), Error> {
        let account_details =
            AccountsPlugin::get_account(user.clone()).expect("Get account failed");
        if account_details.is_none() {
            return Err(InvalidAccountName(user).into());
        }

        let app = get_assert_top_level_app("login", &vec![])?;

        if *app != psibase::services::accounts::SERVICE.to_string() {
            let connected_apps = UserTable::new(&user).get_connected_apps();
            if !connected_apps.contains(&app) {
                return Err(NotConnected(user).into());
            }
        }

        AppsTable::new(&app).login(&user);
        HostAuth::set_logged_in_user(&user, &app);
        Ok(())
    }

    fn logout() -> Result<(), Error> {
        let app = get_assert_top_level_app("logout", &vec!["supervisor"])?;
        AppsTable::new(&app).logout();

        // TODO: request server to remove query token cookie
        println!("logout(). REMOVE cookie");

        Ok(())
    }

    fn get_connected_accounts() -> Result<Vec<String>, Error> {
        let app = get_assert_top_level_app("get_connected_accounts", &vec!["supervisor"])?;
        Ok(AppsTable::new(&app).get_connected_accounts())
    }

    fn create_connection_token() -> Result<String, Error> {
        let app = get_assert_top_level_app("create_connection_token", &vec![])?;
        let origin = get_app_url(&app);
        Ok(Token::new_connection_token(ConnectionToken {
            app: Some(app),
            origin,
        })
        .into())
    }
}
