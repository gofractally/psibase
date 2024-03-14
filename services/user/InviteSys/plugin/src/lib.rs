use serde_json::to_string;

// From other plugins
#[allow(warnings)]
mod bindings;
use bindings::account_sys::plugin::accounts;
use bindings::auth_sys::plugin::keyvault;
use bindings::common::plugin::{client, server};
use bindings::exports::invite_sys::plugin::{
    admin::Guest as Admin, invitee::Guest as Invitee, inviter::Guest as Inviter,
};

struct Component;

/*
    /// This doesn't need to be exposed, it can just be jammed into various plugin functions
    /// when the user is submitting another action anyways.
    /// Used by anyone to garbage collect expired invites. Up to 'maxDeleted' invites
    /// can be deleted by calling this action
    void delExpired(uint32_t maxDeleted);
*/

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
    fn generate_invite(callback_subpath: String) -> Result<String, String> {
        let inviter = accounts::get_logged_in_user()?;
        let inviter = match inviter {
            Some(i) => i,
            None => {
                return Err("Only existing accounts can create invites".to_string());
            }
        };

        let pubkey: psibase::PublicKey = keyvault::generate_keypair()?.parse().unwrap();

        // Todo - link to the psibase crate to get the invite-sys service wrapper for the
        //   create_invite action struct.
        // server::add_action_to_transaction(
        //     "invite-sys",
        //     "createInvite",
        //     &to_string(&action_structs::create_invite {
        //         inviteKey: pubkey.to_owned(),
        //     })
        //     .unwrap(),
        // )?;

        let invite_domain = client::get_root_domain().unwrap();
        let invited_page: String = "/invited".to_string();
        let link_root = format!("{}{}", invite_domain, invited_page);

        let origination = client::get_sender_app()?;
        let originator = match origination.app {
            Some(o) => o,
            None => {
                // Todo - revisit this later, can we open it to external apps?
                return Err("Only hosted apps can generate invites".to_string());
            }
        };
        let callback_url = format!("{}{}", origination.root_domain.unwrap(), callback_subpath);
        let invite_key = pubkey.to_string();
        let query_string = format!(
            "inviter={}&app={}&pk={}&cb={}",
            inviter, originator, invite_key, callback_url
        );

        // Todo - For ergonomics, consider base64 encoding the querystring
        //   and provide a function to easily decode it

        Ok(urlencoding::encode(&format!("{}?{}", link_root, query_string)).into_owned())
    }

    fn delete_invite(_invite_public_key: Vec<u8>) -> Result<(), String> {
        Err("Not yet implemented".to_string())
    }
}

bindings::export!(Component with_types_in bindings);
