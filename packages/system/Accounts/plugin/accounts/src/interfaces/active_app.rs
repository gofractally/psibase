use crate::bindings;

use crate::db::{apps_table::*, user_table::*};
use crate::errors::ErrorType::*;
use crate::helpers::*;
use crate::plugin::AccountsPlugin;
use bindings::*;
use exports::accounts::plugin::{
    active_app::{Guest as ActiveApp, *},
    api::Guest as Api,
};
use host::auth::api as HostAuth;
use host::common::client;
use host::prompt::api as Prompt;

impl ActiveApp for AccountsPlugin {
    fn login(user: String) -> Result<(), Error> {
        let account_details =
            <AccountsPlugin as Api>::get_account(user.clone()).expect("Get account failed");
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
        if HostAuth::set_logged_in_user(&user, &app).is_err() {
            AppsTable::new(&app).logout();
        }
        Ok(())
    }

    fn logout() -> Result<(), Error> {
        let app = get_assert_top_level_app("logout", &vec!["supervisor"])?;
        let apps_table = AppsTable::new(&app);

        if apps_table.get_logged_in_user().is_some() {
            apps_table.logout();
        }

        Ok(())
    }

    fn disconnect(account: String) -> Result<(), Error> {
        let app = get_assert_top_level_app("disconnect", &vec![client::get_receiver().as_str()])?;
        let apps_table = AppsTable::new(&app);

        if !apps_table.get_connected_accounts().contains(&account) {
            return Ok(());
        }

        apps_table.disconnect(&account);
        Ok(())
    }

    fn get_connected_accounts() -> Result<Vec<String>, Error> {
        let app = get_assert_top_level_app("get_connected_accounts", &vec!["supervisor"])?;
        Ok(AppsTable::new(&app).get_connected_accounts())
    }

    fn connect_account() -> Result<(), Error> {
        let sender = client::get_sender();

        assert!(
            sender == client::get_active_app()
                || sender == psibase::services::invite::SERVICE.to_string(),
            "Unauthorized",
        );

        Prompt::prompt("connect", None);

        Ok(())
    }
}
