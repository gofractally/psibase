#[allow(warnings)]
mod bindings;
use base64::{engine::general_purpose::URL_SAFE, Engine};
use bindings::account_sys::plugin::accounts;
use bindings::auth_sys::plugin::keyvault;
use bindings::common::plugin::{client, server, types as CommonTypes};
use bindings::exports::invite_sys::plugin::{
    admin::Guest as Admin, invitee::Guest as Invitee, inviter::Guest as Inviter,
};
use bindings::invite_sys::plugin::types::{Invite, InviteId, Url};
use fracpack::Pack;
use psibase::services::invite_sys as invite_service;
use serde::{Deserialize, Serialize};

mod errors;
use errors::ErrorType::*;

/*
    /// This doesn't need to be exposed, it can just be jammed into various plugin functions
    /// when the user is submitting another action anyways.
    /// Used by anyone to garbage collect expired invites. Up to 'maxDeleted' invites
    /// can be deleted by calling this action
    void delExpired(uint32_t maxDeleted);
*/

#[derive(Serialize, Deserialize)]
struct InviteParams {
    inviter: String,
    app: String,
    pk: String,
    cb: String,
}

#[derive(Deserialize)]
struct ResponseRoot {
    data: Data,
}

#[allow(non_snake_case)]
#[derive(Deserialize)]
struct Data {
    getInvite: Option<GetInvite>,
}

#[allow(non_snake_case)]
#[derive(Deserialize)]
struct GetInvite {
    pubkey: String,
    inviter: String,
}

struct Component;

// Consider moving to admin plugin
impl Admin for Component {
    fn set_whitelist(_accounts: Vec<String>) -> Result<(), CommonTypes::Error> {
        Err(NotYetImplemented.err("set_whitelist"))
    }

    fn set_blacklist(_accounts: Vec<String>) -> Result<(), CommonTypes::Error> {
        Err(NotYetImplemented.err("set_blacklist"))
    }
}

impl Invitee for Component {
    fn accept(_id: InviteId) -> Result<(), CommonTypes::Error> {
        Err(NotYetImplemented.err("accept_with_existing_account"))
        // The thinking for only a single accept method is that the invite ID is passed
        // to the account plugin. If the invite contains a valid invite private key
        // then the login page can also show a Create Account button.
    }

    fn reject(_id: InviteId) -> Result<(), CommonTypes::Error> {
        Err(NotYetImplemented.err("reject"))
    }

    fn decode_invite(id: InviteId) -> Result<Invite, CommonTypes::Error> {
        let decoded = match URL_SAFE.decode(id.to_owned()) {
            Ok(enc) => match String::from_utf8(enc) {
                Ok(dec) => dec,
                Err(_) => {
                    return Err(DecodeInviteError.err("Error converting from UTF8"));
                }
            },
            Err(_) => {
                return Err(DecodeInviteError.err("Error decoding base64"));
            }
        };
        let decoded: InviteParams = match serde_json::from_str(&decoded) {
            Ok(d) => d,
            Err(_) => {
                return Err(DecodeInviteError.err("Error deserializing JSON string into object"));
            }
        };
        let url = format!("{}/graphql", client::my_service_origin()?);
        let pubkey = &decoded.pk;
        let query = format!(
            r#"query {{
                getInvite(pubkey: "{pubkey}") {{
                    pubkey,
                    inviter
                }}
            }}"#,
            pubkey = pubkey
        );
        let response: ResponseRoot = match server::post_graphql_get_json(&url, &query) {
            Ok(o) => match serde_json::from_str(&o) {
                Ok(parsed) => parsed,
                Err(e) => {
                    return Err(QueryError.err(&e.to_string()));
                }
            },
            Err(e) => {
                return Err(QueryError.err(&e.message));
            }
        };
        let inv = match response.data.getInvite {
            Some(inv) => inv,
            None => {
                return Err(QueryError.err("Invite not found"));
            }
        };

        if inv.inviter != decoded.inviter {
            return Err(CorruptedInviteId.err(&id));
        }

        Ok(Invite {
            inviter: decoded.inviter,
            app: decoded.app,
            callback: decoded.cb,
        })
    }
}

impl Inviter for Component {
    fn generate_invite(callback_subpath: String) -> Result<Url, CommonTypes::Error> {
        let inviter = accounts::get_logged_in_user()?;

        let inviter = match inviter {
            Some(i) => i,
            None => {
                return Err(InviterLoggedIn.err(""));
            }
        };

        // TODO: I actually need a function here to generate both a private and
        //         public key (and return them both). Private needs to be added to invite link,
        //         while public is pushed in a tx to add the invite to the chain.
        //       When I do this, also update decode.
        let pubkey_str = keyvault::generate_keypair()?;
        let pubkey: psibase::PublicKey = match pubkey_str.parse() {
            Ok(key) => key,
            Err(_) => {
                return Err(PubKeyParse.err(&pubkey_str));
            }
        };

        server::add_action_to_transaction(
            "createInvite",
            &invite_service::action_structs::createInvite {
                inviteKey: pubkey.to_owned(),
            }
            .packed(),
        )?;

        let link_root = format!("{}{}", client::my_service_origin()?, "/invited");

        let orig_data = client::get_sender_app()?;
        let orig_domain = orig_data.origin;
        let originator = orig_data.app.unwrap_or(orig_domain.clone());

        let callback_url = format!("{}{}", orig_domain, callback_subpath);
        let params = InviteParams {
            inviter,
            app: originator,
            pk: pubkey_str,
            cb: callback_url,
        };
        let params = match serde_json::to_string(&params) {
            Ok(p) => p,
            Err(_) => {
                return Err(SerializationError.err("Serializing invite id params"));
            }
        };

        let query_string = format!("id={}", URL_SAFE.encode(params));
        Ok(format!("{}?{}", link_root, query_string))
    }

    fn delete_invite(_invite_public_key: Vec<u8>) -> Result<(), CommonTypes::Error> {
        Err(NotYetImplemented.err("delete_invite"))
    }
}

bindings::export!(Component with_types_in bindings);
