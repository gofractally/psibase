#[allow(warnings)]
mod bindings;

use std::str::FromStr;

use bindings::exports::profiles::plugin::api::Guest as Api;
use bindings::profiles::plugin::types::Contact;
use bindings::profiles::plugin::types::Profile as PluginProfile;

use bindings::exports::profiles::plugin::api::File;

use bindings::accounts::plugin::api::get_current_user;
use bindings::host::common::server as CommonServer;
use bindings::host::common::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::{Pack, Unpack};

use psibase::AccountNumber;

mod errors;
use errors::ErrorType;

mod contact_table;

struct ProfilesPlugin;

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

    fn upload_avatar(file: File, compression_quality: u8) -> Result<(), Error> {
        bindings::sites::plugin::api::upload(&file, compression_quality)
    }

    fn remove_avatar() -> Result<(), Error> {
        bindings::sites::plugin::api::remove("/profile/avatar")
    }

    fn get_contacts() -> Result<Vec<Contact>, Error> {
        let current_user = get_current_user()
            .expect("Failed to get current user status")
            .expect("No user logged in");

        let user_table = contact_table::ContactTable::new(AccountNumber::from_str(current_user.as_str()).unwrap());
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

    fn add_contact(new_contact: Contact) -> Result<(), Error> {
        let current_user = get_current_user()
            .expect("Failed to get current user status")
            .expect("No user logged in");

        let user_table = contact_table::ContactTable::new(AccountNumber::from_str(current_user.as_str()).unwrap());
        let contact = contact_table::ContactEntry::new(
            new_contact.account,
            new_contact.nickname,
            new_contact.email,
            new_contact.phone,
        );
        user_table.add(contact)
    }

    fn update_contact(updated_contact: Contact) -> Result<(), Error> {
        let current_user = get_current_user()
            .expect("Failed to get current user status")
            .expect("No user logged in");

        let contact_table = contact_table::ContactTable::new(AccountNumber::from_str(current_user.as_str()).unwrap());
        let contact = contact_table::ContactEntry::new(
            updated_contact.account,
            updated_contact.nickname,
            updated_contact.email,
            updated_contact.phone,
        );
        contact_table.update_contact(contact)
    }

    fn remove_contact(account: String) -> Result<(), Error> {
        let account_number = AccountNumber::from_str(&account)
            .map_err(|_| ErrorType::InvalidAccountNumber(account))?;

        let current_user = get_current_user()
            .expect("Failed to get current user status")
            .expect("No user logged in");

        let user_table = contact_table::ContactTable::new(AccountNumber::from_str(current_user.as_str()).unwrap());

        user_table.remove(account_number)
    }
}

bindings::export!(ProfilesPlugin with_types_in bindings);
