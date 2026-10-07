use crate::bindings::exports::host::login_prompt::admin::Guest as Admin;
use crate::bindings::host::session::admin as HostSessionAdmin;
use crate::helpers::KNOWN_ACCOUNTS_APP;
use crate::plugin::LoginPrompt;
use crate::trust::*;

impl Admin for LoginPrompt {
    fn remove_account(account: String) {
        assert_authorized(FunctionName::remove_account).unwrap();

        let connected_apps = HostSessionAdmin::get_connected_apps(&account);
        for app in connected_apps {
            HostSessionAdmin::disconnect(&account, &app);
        }

        HostSessionAdmin::disconnect(&account, KNOWN_ACCOUNTS_APP);
    }

    fn get_all_accounts() -> Vec<String> {
        assert_authorized_with_whitelist(FunctionName::get_all_accounts, vec!["supervisor".into()])
            .unwrap();
        HostSessionAdmin::get_connected_accounts(KNOWN_ACCOUNTS_APP)
    }
}
