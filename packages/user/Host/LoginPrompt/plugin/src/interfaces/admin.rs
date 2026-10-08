use crate::bindings::exports::host::login_prompt::admin::Guest as Admin;
use crate::bindings::host::accounts::admin as HostAccountsAdmin;
use crate::plugin::LoginPrompt;
use crate::trust::*;
use psibase::services::host;

impl Admin for LoginPrompt {
    fn remove_account(account: String) {
        assert_authorized(FunctionName::remove_account).unwrap();

        let connected_apps = HostAccountsAdmin::get_connected_apps(&account);
        for app in connected_apps {
            HostAccountsAdmin::disconnect(&account, &app);
        }

        HostAccountsAdmin::disconnect(&account, &host::Wrapper::SERVICE.to_string());
    }

    fn get_all_accounts() -> Vec<String> {
        assert_authorized_with_whitelist(FunctionName::get_all_accounts, vec!["supervisor".into()])
            .unwrap();
        HostAccountsAdmin::get_connected_accounts(&host::Wrapper::SERVICE.to_string())
    }
}
