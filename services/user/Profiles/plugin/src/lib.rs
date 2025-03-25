#[allow(warnings)]
mod bindings;

use bindings::exports::profiles::plugin::api::Guest as Api;
use bindings::exports::profiles::plugin::contacts::Guest as Contacts;

use bindings::exports::profiles::plugin::contacts::Contact;

use bindings::profiles::plugin::types::Profile as PluginProfile;

use bindings::profiles::plugin::types::Avatar;

use bindings::sites::plugin::types::File;

use bindings::accounts::plugin::api::{get_account, get_current_user};
use bindings::host::common::client as Client;
use bindings::host::common::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;

mod errors;
use errors::ErrorType;

mod contact_table;

use contact_table::ContactTable;

struct ProfilesPlugin;

fn check_app_sender() -> Result<(), ErrorType> {
    match Client::get_sender_app().app {
        Some(app) if app == "homepage" => Ok(()),
        _ => Err(ErrorType::UnauthorizedApp()),
    }
}

fn check_account_exists(account: &str) -> Result<(), Error> {
    get_account(account)?
        .ok_or(ErrorType::NoAccountFound(account.to_string()).into())
        .map(|_| ())
}

fn user() -> Result<String, Error> {
    get_current_user()?.ok_or(ErrorType::NoUserLoggedIn().into())
}

impl Contacts for ProfilesPlugin {
    fn set(contact: Contact, overwrite: bool) -> Result<(), Error> {
        check_app_sender()?;
        check_account_exists(&contact.account)?;

        ContactTable::new(user()?).set(contact, overwrite)
    }

    fn remove(account: String) -> Result<(), Error> {
        check_app_sender()?;
        check_account_exists(&account)?;

        ContactTable::new(user()?).remove(&account)
    }

    fn get() -> Result<Vec<Contact>, Error> {
        check_app_sender()?;

        let contacts = ContactTable::new(user()?).get_contacts();

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
    fn set_profile(profile: PluginProfile) -> Result<(), Error> {
        check_app_sender()?;

        let packed_profile_args = profiles::action_structs::setProfile {
            display_name: profile.display_name.unwrap_or_default(),
            bio: profile.bio.unwrap_or_default(),
            avatar: profile.avatar,
        }
        .packed();

        add_action_to_transaction(
            profiles::action_structs::setProfile::ACTION_NAME,
            &packed_profile_args,
        )
    }

    fn upload_avatar(avatar: Avatar) -> Result<(), Error> {
        check_app_sender()?;

        let max_avatar_size: usize = 100 * 1024;

        if avatar.content.len() > max_avatar_size {
            return Err(ErrorType::AvatarTooBig("100KB".to_string()).into());
        }

        let file = File {
            content_type: avatar.content_type,
            content: avatar.content,
            path: "/profile/avatar".to_string(),
        };

        bindings::sites::plugin::api::upload(&file, 11)
    }

    fn remove_avatar() -> Result<(), Error> {
        check_app_sender()?;

        bindings::sites::plugin::api::remove("/profile/avatar")
    }
}

bindings::export!(ProfilesPlugin with_types_in bindings);
