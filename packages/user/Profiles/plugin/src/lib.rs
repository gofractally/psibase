#[allow(warnings)]
mod bindings;

use bindings::exports::profiles::plugin::api::Guest as Api;
use bindings::exports::profiles::plugin::contacts::Guest as Contacts;

use bindings::exports::profiles::plugin::contacts::Contact;

use bindings::profiles::plugin::types::Profile as PluginProfile;

use bindings::profiles::plugin::types::Avatar;

use bindings::sites::plugin::types::File;

use bindings::accounts::plugin::api::{get_account, get_current_user};
use bindings::host::types::types::Error;
use bindings::transact::plugin::intf::add_action_to_transaction;

use psibase::fracpack::Pack;

mod errors;
use errors::ErrorType;

mod contact_table;

use crate::trust::*;
use contact_table::ContactTable;

psibase::define_trust! {
    descriptions {
        Low => "
            - Manage (add and remove) contacts
        ",
        Medium => "
            - Update your profile
            - Upload your avatar
            - Remove your avatar
        ",
        High => "
            - Read all your contacts
        ",
    }
    functions {
        None => [],
        Low => [set, remove],
        Medium => [set_profile, upload_avatar, remove_avatar],
        High => [get],
    }
}

struct ProfilesPlugin;

fn check_account_exists(account: &str) -> Result<(), Error> {
    get_account(account)?
        .ok_or(ErrorType::NoAccountFound(account.to_string()).into())
        .map(|_| ())
}

fn user() -> Result<String, Error> {
    get_current_user().ok_or(ErrorType::NoUserLoggedIn().into())
}

impl Contacts for ProfilesPlugin {
    fn set(contact: Contact, overwrite: bool) -> Result<(), Error> {
        assert_authorized_with_whitelist(FunctionName::set, vec!["homepage".into()])?;
        check_account_exists(&contact.account)?;

        ContactTable::new(user()?).set(contact, overwrite)
    }

    fn remove(account: String) -> Result<(), Error> {
        assert_authorized_with_whitelist(FunctionName::remove, vec!["homepage".into()])?;
        check_account_exists(&account)?;

        ContactTable::new(user()?).remove(&account)
    }

    fn get() -> Result<Vec<Contact>, Error> {
        assert_authorized_with_whitelist(FunctionName::get, vec!["homepage".into()])?;

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
        assert_authorized_with_whitelist(FunctionName::set_profile, vec!["homepage".into()])?;

        let packed_profile_args = profiles::action_structs::setProfile {
            display_name: profile.display_name.unwrap_or_default(),
            bio: profile.bio.unwrap_or_default(),
        }
        .packed();

        add_action_to_transaction(
            profiles::action_structs::setProfile::ACTION_NAME,
            &packed_profile_args,
        )
    }

    fn upload_avatar(avatar: Avatar) -> Result<(), Error> {
        assert_authorized_with_whitelist(FunctionName::upload_avatar, vec!["homepage".into()])?;

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
        assert_authorized_with_whitelist(FunctionName::remove_avatar, vec!["homepage".into()])?;

        bindings::sites::plugin::api::remove("/profile/avatar")
    }
}

bindings::export!(ProfilesPlugin with_types_in bindings);
