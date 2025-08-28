use crate::bindings::exports::accounts::plugin::prompt::Guest as Prompt;
use crate::bindings::host::{auth::api as HostAuth, common::client as Client};
use crate::db::{apps_table::AppsTable, user_table::UserTable};
use crate::helpers::assert_valid_account;
use crate::plugin::AccountsPlugin;

impl Prompt for AccountsPlugin {
    fn connect_account(account: String) {
        assert_eq!(Client::get_sender(), Client::get_receiver());

        // The account must already have been imported
        assert!(AppsTable::new(&Client::get_receiver())
            .get_connected_accounts()
            .contains(&account));

        let app = Client::get_active_app();
        AppsTable::new(&app).login(&account);
        UserTable::new(&account).add_connected_app(&app);

        if HostAuth::set_logged_in_user(&account, &app).is_err() {
            AppsTable::new(&app).logout();
            UserTable::new(&account).remove_connected_app(&app);
        }
    }

    fn import_existing(account: String) {
        assert_eq!(Client::get_sender(), Client::get_receiver());

        assert_valid_account(&account);
        AppsTable::new(&Client::get_receiver()).connect(&account);
    }
}
