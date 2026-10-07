use crate::bindings;

use crate::errors::ErrorType::*;
use crate::helpers::*;
use crate::plugin::AccountsPlugin;
use accounts::query::api as AccountsQuery;
use bindings::*;
use exports::accounts::plugin::active_app::{Guest as ActiveApp, *};
use host::client::api as client;
use host::prompt::api as Prompt;
use host::session::admin as HostSessionAdmin;

impl ActiveApp for AccountsPlugin {
    fn login(user: String) -> Result<(), Error> {
        let account_details = AccountsQuery::get_account(&user).expect("Get account failed");
        if account_details.is_none() {
            return Err(InvalidAccountName(user).into());
        }

        let app = get_assert_top_level_app("login", &vec![])?;

        if *app != psibase::services::accounts::SERVICE.to_string() {
            let connected_apps = HostSessionAdmin::get_connected_apps(&user);
            if !connected_apps.contains(&app) {
                return Err(NotConnected(user).into());
            }
        }

        HostSessionAdmin::login(&user, &app)
    }

    fn logout() -> Result<(), Error> {
        let app = get_assert_top_level_app("logout", &vec!["supervisor"])?;
        HostSessionAdmin::logout(&app);
        Ok(())
    }

    fn disconnect(account: String) -> Result<(), Error> {
        let app = get_assert_top_level_app("disconnect", &vec![client::get_receiver().as_str()])?;

        if !HostSessionAdmin::get_connected_accounts(&app).contains(&account) {
            return Ok(());
        }

        HostSessionAdmin::disconnect(&account, &app);
        Ok(())
    }

    fn get_connected_accounts() -> Result<Vec<String>, Error> {
        let app = get_assert_top_level_app("get_connected_accounts", &vec!["supervisor"])?;
        Ok(HostSessionAdmin::get_connected_accounts(&app))
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
