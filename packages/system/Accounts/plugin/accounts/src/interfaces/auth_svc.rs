use crate::bindings::accounts::plugin::types::Claim as AccountsClaim;
use crate::bindings::exports::accounts::plugin::api::Guest as Api;
use crate::bindings::exports::accounts::plugin::auth_svc::Guest as AuthSvc;
use crate::bindings::host::auth::api as HostAuth;
use crate::bindings::host::auth::types::Claim as HostAuthClaim;
use crate::bindings::host::common::client as Client;
use crate::bindings::host::types::types::Error;
use crate::bindings::invite::plugin::redemption as Invites;
use crate::db::{apps_table::AppsTable, user_table::UserTable};
use crate::errors::ErrorType::*;
use crate::plugin::AccountsPlugin;

fn to_host_auth_claim(claim: &AccountsClaim) -> HostAuthClaim {
    HostAuthClaim {
        verify_service: claim.verify_service.clone(),
        raw_data: claim.raw_data.clone(),
    }
}

impl AuthSvc for AccountsPlugin {
    fn connect(account: String, claim: Option<AccountsClaim>) -> Result<(), Error> {
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
            Err(_) => {
                let host_claim = claim.as_ref().map(to_host_auth_claim);
                HostAuth::new_session(&account, &app, host_claim.as_ref())
            }
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
