use crate::bindings::exports::host::login_prompt::admin::Guest as Admin;
use crate::bindings::host::accounts::admin as HostAccountsAdmin;
use crate::helpers::KNOWN_ACCOUNTS_APP;
use crate::plugin::LoginPrompt;
use crate::trust::*;

impl Admin for LoginPrompt {
    fn remove_account(account: String) {
        assert_authorized(FunctionName::remove_account).unwrap();

        let connected_apps = HostAccountsAdmin::get_connected_apps(&account);
        for app in connected_apps {
            HostAccountsAdmin::disconnect(&account, &app);
        }

        HostAccountsAdmin::disconnect(&account, KNOWN_ACCOUNTS_APP);
    }

    fn get_all_accounts() -> Vec<String> {
        assert_authorized_with_whitelist(FunctionName::get_all_accounts, vec!["supervisor".into()])
            .unwrap();
        HostAccountsAdmin::get_connected_accounts(KNOWN_ACCOUNTS_APP)
    }
}
