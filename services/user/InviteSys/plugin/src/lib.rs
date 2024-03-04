#[allow(warnings)]
mod bindings;

use crate::bindings::exports::invites::plugin::admin;
use crate::bindings::exports::invites::plugin::invitee;
use crate::bindings::exports::invites::plugin::inviter;

struct Component;

/*
    /// This doesn't need to be exposed, it can just be jammed into various plugin functions
    /// when the user is submitting another action anyways.
    /// Used by anyone to garbage collect expired invites. Up to 'maxDeleted' invites
    /// can be deleted by calling this action
    void delExpired(uint32_t maxDeleted);
*/

impl admin::Guest for Component {
    fn set_whitelist(accounts: Vec<String>) -> Result<(), String> {
        Err("Not yet implemented".to_string())
    }

    fn set_blacklist(accounts: Vec<String>) -> Result<(), String> {
        Err("Not yet implemented".to_string())
    }
}

impl invitee::Guest for Component {
    fn accept_with_existing_account(invite_public_key: Vec<u8>) -> Result<(), String> {
        Err("Not yet implemented".to_string())
    }

    fn accept_with_new_account(
        new_account_name: String,
        invite_public_key: Vec<u8>,
    ) -> Result<(), String> {
        Err("Not yet implemented".to_string())
    }

    fn reject(invite_public_key: Vec<u8>) -> Result<(), String> {
        Err("Not yet implemented".to_string())
    }
}

impl inviter::Guest for Component {
    fn generate_invite(
        generating_user: String,
        app_plugin: inviter::PluginId,
        callback_path: String,
    ) -> Result<String, String> {
        Err("Not yet implemented".to_string())
    }

    fn delete_invite(invite_public_key: Vec<u8>) -> Result<(), String> {
        Err("Not yet implemented".to_string())
    }
}

bindings::export!(Component with_types_in bindings);
