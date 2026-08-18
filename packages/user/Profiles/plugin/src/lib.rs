#[allow(warnings)]
mod bindings;

use bindings::{
    accounts::client_query::api::get_current_user,
    accounts::chain_query::api::get_account,
    exports::profiles::plugin::{
        api::Guest as Api, contacts::Contact, contacts::Guest as Contacts,
    },
    host::{self, types::types::Error},
    permissions,
    profiles::plugin::types::{Avatar, Profile as PluginProfile},
    transact::plugin::api::add_action_to_transaction,
};

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

        if avatar.content.len() > profiles::MAX_AVATAR_SIZE {
            return Err(ErrorType::AvatarTooBig("100KB".to_string()).into());
        }

        let Some(content_type) = profiles::parse_content_type(&avatar.content_type) else {
            return Err(ErrorType::InvalidAvatarContentType(avatar.content_type).into());
        };

        let packed = profiles::action_structs::uploadAvatar {
            image: avatar.content,
            contentType: content_type,
        }
        .packed();

        add_action_to_transaction(
            profiles::action_structs::uploadAvatar::ACTION_NAME,
            &packed,
        )
    }

    fn remove_avatar() -> Result<(), Error> {
        assert_authorized_with_whitelist(FunctionName::remove_avatar, vec!["homepage".into()])?;

        add_action_to_transaction(
            profiles::action_structs::removeAvatar::ACTION_NAME,
            &profiles::action_structs::removeAvatar {}.packed(),
        )
    }

    fn has_read_permission() -> bool {
        permissions::plugin::api::has_auth(
            &host::client::api::get_sender(),
            permissions::plugin::types::TrustLevel::High,
            &["homepage".into()],
        )
    }
}

bindings::export!(ProfilesPlugin with_types_in bindings);
