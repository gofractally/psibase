use crate::bindings::exports::host::login_prompt::admin::Guest as Admin;
use crate::bindings::host::wallet::admin as HostWalletAdmin;
use crate::plugin::LoginPrompt;
use crate::trust::*;
use crate::HOST_APP;

impl Admin for LoginPrompt {
    fn remove_account(account: String) {
        assert_authorized(FunctionName::remove_account).unwrap();

        let connected_apps = HostWalletAdmin::get_connected_apps(&account);
        for app in connected_apps {
            HostWalletAdmin::disconnect(&account, &app);
        }

        HostWalletAdmin::disconnect(&account, HOST_APP);
    }

    fn get_all_accounts() -> Vec<String> {
        assert_authorized_with_whitelist(FunctionName::get_all_accounts, vec!["supervisor".into()])
            .unwrap();
        HostWalletAdmin::get_connected_accounts(HOST_APP)
    }
}
