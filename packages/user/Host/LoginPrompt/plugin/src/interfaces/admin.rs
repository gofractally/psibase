use crate::auth_service;
use crate::bindings::exports::host::login_prompt::admin::{Credential, Guest as Admin};
use crate::bindings::host::accounts::admin as HostAccountsAdmin;
use crate::bindings::host::types::types::Error;
use crate::plugin::LoginPrompt;
use crate::trust::*;
use crate::HOST_APP;

impl Admin for LoginPrompt {
    fn import_existing(credentials: Vec<Credential>) -> Result<(), Vec<(String, Error)>> {
        assert_authorized_with_whitelist(FunctionName::import_existing, vec!["homepage".into()])
            .unwrap();
        auth_service::import_existing(credentials)
    }

    fn remove_account(account: String) {
        assert_authorized(FunctionName::remove_account).unwrap();

        let connected_apps = HostAccountsAdmin::get_connected_apps(&account);
        for app in connected_apps {
            HostAccountsAdmin::disconnect(&account, &app);
        }

        HostAccountsAdmin::disconnect(&account, HOST_APP);
    }

    fn get_all_accounts() -> Vec<String> {
        assert_authorized_with_whitelist(FunctionName::get_all_accounts, vec!["supervisor".into()])
            .unwrap();
        HostAccountsAdmin::get_connected_accounts(HOST_APP)
    }
}
