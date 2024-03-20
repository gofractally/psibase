#[allow(warnings)]
mod bindings;
use bindings::account_sys::plugin::accounts;
use bindings::auth_sys::plugin::keyvault;
use bindings::common::plugin::types as CommonTypes;
use bindings::common::plugin::{client, server};
use bindings::exports::invite_sys::plugin::{
    admin::Guest as Admin, invitee::Guest as Invitee, inviter::Guest as Inviter,
};

use fracpack::Pack;
use psibase::services::invite_sys as invite_service;

mod errors;
use errors::ErrorType::*;

/*
    /// This doesn't need to be exposed, it can just be jammed into various plugin functions
    /// when the user is submitting another action anyways.
    /// Used by anyone to garbage collect expired invites. Up to 'maxDeleted' invites
    /// can be deleted by calling this action
    void delExpired(uint32_t maxDeleted);
*/

struct Component;

impl Admin for Component {
    fn set_whitelist(_accounts: Vec<String>) -> Result<(), String> {
        Err("Not yet implemented".to_string())
    }

    fn set_blacklist(_accounts: Vec<String>) -> Result<(), String> {
        Err("Not yet implemented".to_string())
    }
}

impl Invitee for Component {
    fn accept_with_existing_account(_invite_public_key: Vec<u8>) -> Result<(), String> {
        Err("Not yet implemented".to_string())
    }

    fn accept_with_new_account(
        _new_account_name: String,
        _invite_public_key: Vec<u8>,
    ) -> Result<(), String> {
        Err("Not yet implemented".to_string())
    }

    fn reject(_invite_public_key: Vec<u8>) -> Result<(), String> {
        Err("Not yet implemented".to_string())
    }
}

impl Inviter for Component {
    fn generate_invite(callback_subpath: String) -> Result<String, CommonTypes::Error> {
        let inviter = accounts::get_logged_in_user()?;

        let inviter = match inviter {
            Some(i) => i,
            None => {
                return Err(InviterLoggedIn.err());
            }
        };

        let pubkey = keyvault::generate_keypair()?;
        let pubkey: psibase::PublicKey = match pubkey.parse() {
            Ok(key) => key,
            Err(_) => {
                return Err(PubKeyParse.err());
            }
        };

        server::add_action_to_transaction(
            "createInvite",
            &invite_service::action_structs::createInvite {
                inviteKey: pubkey.to_owned(),
            }
            .packed(),
        )?;

        let link_root = format!("{}{}", client::my_service_domain()?, "/invited");

        let orig_data = client::get_sender_app()?;
        let orig_domain = orig_data.origination_domain;
        let originator = orig_data.app.unwrap_or(orig_domain.clone());

        let callback_url = format!("{}{}", orig_domain, callback_subpath);
        let query_string = format!(
            "inviter={}&app={}&pk={}&cb={}",
            inviter, originator, pubkey, callback_url
        );

        // Todo - For ergonomics, consider encoding the querystring
        //   and provide a function to easily decode it

        Ok(urlencoding::encode(&format!("{}?{}", link_root, query_string)).into_owned())
    }

    fn delete_invite(_invite_public_key: Vec<u8>) -> Result<(), String> {
        Err("Not yet implemented".to_string())
    }
}

bindings::export!(Component with_types_in bindings);
