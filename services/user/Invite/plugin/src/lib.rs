#[allow(warnings)]
mod bindings;
use base64::{engine::general_purpose::URL_SAFE, Engine};
use bindings::auth_sig::plugin::keyvault;
use bindings::auth_sig::plugin::types::Pem;
use bindings::exports::invite;
use bindings::host::common::{client as Client, server as Server, types as CommonTypes};
use bindings::invite::plugin::types::{Invite, InviteId, InviteState, Url};
use bindings::transact::plugin::intf as Transact;
use chrono::DateTime;
use fracpack::Pack;
use invite::plugin::{invitee::Guest as Invitee, inviter::Guest as Inviter};
use psibase::services::invite as InviteService;
use CommonTypes::OriginationData;

use serde::{Deserialize, Serialize};

mod errors;
use errors::ErrorType::*;

/* TODO:
    /// This doesn't need to be exposed, it can just be jammed into various plugin functions
    /// when the user is submitting another action anyways.
    /// Used by anyone to garbage collect expired invites. Up to 'maxDeleted' invites
    /// can be deleted by calling this action
    void delExpired(uint32_t maxDeleted);


    Add a registration service that allows an app to specify subpage links:
     * TOS subpage
     * Privacy policy subpage
     * App homepage subpage
     * Brief description (<= 200 characters)
    These can be used on the login page, when logging into a particular app, there can be links
        that can help verify that you're logging into what you think you're logging into.
*/

#[derive(Serialize, Deserialize)]
struct InviteParams {
    app: String,
    pk: String,
    cb: String,
}

#[derive(Deserialize)]
struct ResponseRoot<T> {
    data: T,
}
trait TryParseGqlResponse: Sized {
    fn from_gql(s: String) -> Result<Self, CommonTypes::Error>;
}

//#[qgl_query(name="getInvite")] // <-- Todo: Create this procedural macro ...
#[allow(non_snake_case)]
#[derive(Deserialize)]
struct InviteRecordSubset {
    inviter: psibase::AccountNumber,
    actor: psibase::AccountNumber,
    expiry: u32,
    state: u8,
}

//                                           ...Such that the below code is generated:
#[allow(non_snake_case)]
#[derive(Deserialize)]
struct GetInviteResponse {
    getInvite: Option<InviteRecordSubset>,
}
impl TryParseGqlResponse for InviteRecordSubset {
    fn from_gql(response: String) -> Result<Self, CommonTypes::Error> {
        let response_root: ResponseRoot<GetInviteResponse> =
            serde_json::from_str(&response).map_err(|e| QueryError.err(&e.to_string()))?;
        Ok(response_root.data.getInvite.ok_or_else(|| {
            QueryError.err("Unable to extract InviteRecordSubset from query response")
        })?)
    }
}
//                                            />

struct Component;

impl From<InviteParams> for InviteId {
    fn from(params: InviteParams) -> Self {
        let params_str = serde_json::to_string(&params).unwrap();
        URL_SAFE.encode(params_str)
    }
}

trait TryFromInviteId: Sized {
    fn try_from_invite_id(id: InviteId) -> Result<Self, CommonTypes::Error>;
}

impl TryFromInviteId for InviteParams {
    fn try_from_invite_id(id: InviteId) -> Result<Self, CommonTypes::Error> {
        let bytes = URL_SAFE
            .decode(id.to_owned())
            .map_err(|_| DecodeInviteError.err("Error decoding base64"))?;

        let str = String::from_utf8(bytes)
            .map_err(|_| DecodeInviteError.err("Error converting from UTF8"))?;

        let result: InviteParams = serde_json::from_str(&str)
            .map_err(|_| DecodeInviteError.err("Error deserializing JSON string into object"))?;

        Ok(result)
    }
}

impl Invitee for Component {
    fn accept(_id: InviteId) -> Result<(), CommonTypes::Error> {
        Err(NotYetImplemented.err("accept_with_existing_account"))
        // The thinking for only a single accept method is that the invite ID is passed
        // to the account plugin. If the invite contains a valid invite private key
        // then the login page can also show a Create Account button.
    }

    fn accept_temp(account: String, id: InviteId) -> Result<(), CommonTypes::Error> {
        let accepted_by = psibase::AccountNumber::from_exact(&account).or_else(|_| {
            return Err(InvalidAccount.err(&account));
        })?;
        // Todo: Check that the account does not already exist.

        let invite_params = InviteParams::try_from_invite_id(id)?;
        let invite_pubkey: Pem = keyvault::pub_from_priv(&invite_params.pk)?;

        Transact::add_action_to_transaction(
            "acceptCreate",
            &InviteService::action_structs::acceptCreate {
                inviteKey: keyvault::to_der(&invite_pubkey)?,
                acceptedBy: accepted_by,
                newAccountKey: keyvault::to_der(&keyvault::generate_keypair()?)?,
            }
            .packed(),
        )?;

        Ok(())
    }

    fn reject(_id: InviteId) -> Result<(), CommonTypes::Error> {
        Err(NotYetImplemented.err("reject"))
    }

    fn decode_invite(id: InviteId) -> Result<Invite, CommonTypes::Error> {
        let invite_params = InviteParams::try_from_invite_id(id)?;

        let query = format!(
            r#"query {{
                getInvite(pubkey: "{pubkey}") {{
                    inviter,
                    actor,
                    expiry,
                    state,
                }}
            }}"#,
            pubkey = keyvault::pub_from_priv(&invite_params.pk)?
        );
        let invite = InviteRecordSubset::from_gql(Server::post_graphql_get_json(&query)?)?;

        let expiry = DateTime::from_timestamp(invite.expiry as i64, 0)
            .ok_or(DatetimeError.err("decode_invite"))?
            .to_string();
        let state = match invite.state {
            0 => InviteState::Pending,
            1 => InviteState::Accepted,
            2 => InviteState::Rejected,
            _ => {
                return Err(InvalidInviteState.err("decode_invite"));
            }
        };

        Ok(Invite {
            inviter: invite.inviter.to_string(),
            app: invite_params.app,
            state: state,
            actor: invite.actor.to_string(),
            expiry,
            callback: invite_params.cb,
        })
    }
}

impl Inviter for Component {
    fn generate_invite(callback_subpath: String) -> Result<Url, CommonTypes::Error> {
        //       Todo: update decode with the new key types
        let keypair = keyvault::generate_unmanaged_keypair()?;

        Transact::add_action_to_transaction(
            "createInvite",
            &InviteService::action_structs::createInvite {
                inviteKey: keyvault::to_der(&keypair.public_key)?,
            }
            .packed(),
        )?;

        let link_root = format!("{}{}", Client::my_service_origin(), "/invited");

        let OriginationData { origin, app } = Client::get_sender_app();
        let cb = format!("{}{}", origin, callback_subpath);

        let params = InviteParams {
            app: app.unwrap_or(origin.clone()),
            pk: keypair.private_key,
            cb,
        };

        let query_string = format!("id={}", InviteId::from(params));
        Ok(format!("{}?{}", link_root, query_string))
    }

    fn delete_invite(invite_public_key: Vec<u8>) -> Result<(), CommonTypes::Error> {
        Transact::add_action_to_transaction(
            "delInvite",
            &InviteService::action_structs::delInvite {
                inviteKey: invite_public_key,
            }
            .packed(),
        )?;

        Ok(())
    }
}

bindings::export!(Component with_types_in bindings);
