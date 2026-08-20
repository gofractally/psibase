use crate::bindings::exports::accounts::plugin::api::Guest as Api;
use crate::bindings::exports::accounts::plugin::auth_svc::Guest as AuthSvc;
use crate::bindings::host::auth::api as HostAuth;
use crate::bindings::host::common::client as Client;
use crate::bindings::host::types::types::{Claim, Error};
use crate::bindings::invite::plugin::redemption as Invites;
use crate::db::{apps_table::AppsTable, user_table::UserTable};
use crate::errors::ErrorType::*;
use crate::plugin::AccountsPlugin;

impl AuthSvc for AccountsPlugin {
    fn login(account: String, claim: Option<Claim>) -> Result<(), Error> {
        let auth_service = AccountsPlugin::get_account(account.clone())?
            .ok_or_else(|| AccountNotFound(account.clone()))?
            .auth_service;
        assert!(Client::get_sender() == auth_service);

        // The account must have already been imported
        assert!(AppsTable::new(&Client::get_receiver())
            .get_connected_accounts()
            .contains(&account));

        let app = Client::get_active_app();
        AppsTable::new(&app).login(&account);
        UserTable::new(&account).add_connected_app(&app);

        let session_result = match HostAuth::use_session(&account, &app) {
            Ok(()) => Ok(()),
            Err(_) => HostAuth::new_session(&account, &app, claim.as_ref()),
        };

        if session_result.is_err() {
            AppsTable::new(&app).logout();
            UserTable::new(&account).remove_connected_app(&app);
        } else if Invites::get_active_invite().is_some() {
            Invites::accept();
        }

        session_result
    }
}
