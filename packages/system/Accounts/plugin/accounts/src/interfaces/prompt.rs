use crate::bindings::auth_sig::plugin as AuthSig;
use crate::bindings::exports::accounts::plugin::api::Guest;
use crate::bindings::exports::accounts::plugin::prompt::Guest as Prompt;
use crate::bindings::host::{auth::api as HostAuth, common::client as Client, types::types::Error};
use crate::bindings::invite::plugin::redemption as Invites;
use crate::db::{apps_table::AppsTable, user_table::UserTable};
use crate::errors::ErrorType;
use crate::helpers::assert_valid_account;
use crate::plugin::AccountsPlugin;

impl Prompt for AccountsPlugin {
    fn can_create_account() -> bool {
        assert_eq!(Client::get_sender(), Client::get_receiver());

        if Self::is_logged_in() {
            return true;
        }

        if let Some(can_create_account) = Invites::get_active_invite() {
            return can_create_account;
        }

        false
    }

    fn import_existing(account: String) {
        assert_eq!(Client::get_sender(), Client::get_receiver());

        assert_valid_account(&account);
        AppsTable::new(&Client::get_receiver()).connect(&account);
    }

    fn create_account(account_name: String) -> Result<String, Error> {
        assert_eq!(Client::get_sender(), Client::get_receiver());

        let private_key;

        if Self::is_logged_in() {
            private_key = AuthSig::actions::create_account(&account_name)?;
        } else if Invites::get_active_invite().unwrap_or(false) {
            private_key = Invites::create_new_account(&account_name);
        } else {
            return Err(ErrorType::CannotCreateAccount().into());
        }

        AppsTable::new(&Client::get_receiver()).connect(&account_name);

        Ok(private_key)
    }

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

        if let Some(_) = Invites::get_active_invite() {
            Invites::accept();
        }
    }
}
