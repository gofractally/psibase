#[allow(warnings)]
mod bindings;

use std::str::FromStr;

use bindings::exports::profiles::plugin::api::Guest as Api;
use bindings::exports::profiles::plugin::contacts::Guest as Contacts;

use bindings::exports::profiles::plugin::contacts::Contact;

use bindings::profiles::plugin::types::Profile as PluginProfile;

use bindings::exports::profiles::plugin::api::File;

use bindings::accounts::plugin::api::{get_account, get_current_user};
use bindings::host::common::client as Client;
use bindings::host::common::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;

use psibase::AccountNumber;

mod errors;
use errors::ErrorType;

mod contact_table;

struct ProfilesPlugin;

fn check_app_sender() -> Result<(), ErrorType> {
    match Client::get_sender_app().app {
        Some(app) if app == "homepage" => Ok(()),
        _ => Err(ErrorType::UnauthorizedApp()),
    }
}

fn check_account_exists(account: &str) -> Result<(), ErrorType> {
    get_account(account).map_err(|_| ErrorType::NoAccountFound(account.to_string()))?;
    Ok(())
}

impl Contacts for ProfilesPlugin {
    fn set(contact: Contact) -> Result<(), Error> {
        check_app_sender()?;
        check_account_exists(&contact.account)?;

        let current_user = get_current_user()?.ok_or(ErrorType::NoUserLoggedIn())?;

        let contact_table = contact_table::ContactTable::new(
            AccountNumber::from_str(current_user.as_str()).unwrap(),
        );
        let contact = contact_table::ContactEntry::from(contact);
        contact_table.set(contact)
    }

    fn remove(account: String) -> Result<(), Error> {
        check_app_sender()?;
        check_account_exists(&account)?;

        let account_number = AccountNumber::from_str(&account)
            .map_err(|_| ErrorType::InvalidAccountNumber(account))?;

        let current_user = get_current_user()?.ok_or(ErrorType::NoUserLoggedIn())?;

        let user_table = contact_table::ContactTable::new(
            AccountNumber::from_str(current_user.as_str()).unwrap(),
        );

        user_table.remove(account_number)
    }

    fn get() -> Result<Vec<Contact>, Error> {
        check_app_sender()?;

        let current_user = get_current_user()?.ok_or(ErrorType::NoUserLoggedIn())?;

        let user_table = contact_table::ContactTable::new(
            AccountNumber::from_str(current_user.as_str()).unwrap(),
        );
        let contacts = user_table.get_contacts();

        Ok(contacts
            .into_iter()
            .map(|c| Contact {
                account: c.account.to_string(),
                nickname: c.nickname,
                email: c.email,
                phone: c.phone,
            })
            .collect())
    }
}

impl Api for ProfilesPlugin {
    fn set_profile(profile: PluginProfile) {
        let packed_profile_args = profiles::action_structs::setProfile {
            display_name: profile.display_name.unwrap_or_default(),
            bio: profile.bio.unwrap_or_default(),
            avatar: profile.avatar,
        }
        .packed();

        add_action_to_transaction("setProfile", &packed_profile_args).unwrap();
    }

    fn upload_avatar(file: File) -> Result<(), Error> {
        bindings::sites::plugin::api::upload(&file, 11)
    }

    fn remove_avatar() -> Result<(), Error> {
        bindings::sites::plugin::api::remove("/profile/avatar")
    }
}

bindings::export!(ProfilesPlugin with_types_in bindings);
