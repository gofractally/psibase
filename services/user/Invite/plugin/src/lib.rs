#[allow(warnings)]
mod bindings;
mod errors;
mod types;

use bindings::accounts::plugin as Accounts;
use bindings::auth_invite::plugin::intf as AuthInvite;
use bindings::auth_sig::plugin::{keyvault, types::Pem};
use bindings::exports::invite;
use bindings::exports::invite::plugin::advanced::Guest as Advanced;
use bindings::exports::invite::plugin::advanced::InvKeys as InviteKeys;
use bindings::host::common::{client as Client, server as Server, types as CommonTypes};
use bindings::invite::plugin::types::{Invite, InviteState, InviteToken};
use bindings::transact::plugin::intf as Transact;
use chrono::DateTime;
use errors::ErrorType::*;
use fracpack::Pack;
use invite::plugin::{invitee::Guest as Invitee, inviter::Guest as Inviter};
use psibase::services::invite::{self as InviteService, action_structs::*};
use types::*;

/* TODO:
    /// This doesn't need to be exposed, it can just be jammed into various plugin functions
    /// when the user is submitting another action anyways.
    /// Used by anyone to garbage collect expired invites. Up to 'maxDeleted' invites
    /// can be deleted by calling this action
    void delExpired(uint32_t maxDeleted);
*/

struct InvitePlugin;

impl Invitee for InvitePlugin {
    fn accept_with_new_account(
        account: String,
        token: InviteToken,
    ) -> Result<(), CommonTypes::Error> {
        let accepted_by = psibase::AccountNumber::from_exact(&account).or_else(|_| {
            return Err(InvalidAccount(&account));
        })?;

        if Accounts::api::get_account(&account)?.is_some() {
            return Err(AccountExists("accept_with_new_account").into());
        }

        AuthInvite::notify(&token)?;

        let invite_params = InviteParams::try_from_invite_id(&token)?;
        let invite_pubkey: Pem = keyvault::pub_from_priv(&invite_params.pk)?;

        Transact::add_action_to_transaction(
            acceptCreate::ACTION_NAME,
            &acceptCreate {
                inviteKey: keyvault::to_der(&invite_pubkey)?.into(),
                acceptedBy: accepted_by,
                newAccountKey: keyvault::to_der(&keyvault::generate_keypair()?)?.into(),
            }
            .packed(),
        )?;

        Ok(())
    }

    fn accept(token: InviteToken) -> Result<(), CommonTypes::Error> {
        let invite_params = InviteParams::try_from_invite_id(&token)?;
        let invite_pubkey: Pem = keyvault::pub_from_priv(&invite_params.pk)?;

        AuthInvite::notify(&token)?;

        Transact::add_action_to_transaction(
            accept::ACTION_NAME,
            &accept {
                inviteKey: keyvault::to_der(&invite_pubkey)?.into(),
            }
            .packed(),
        )?;

        Ok(())
    }

    fn reject(token: InviteToken) -> Result<(), CommonTypes::Error> {
        let invite_params = InviteParams::try_from_invite_id(&token)?;
        let invite_pubkey: Pem = keyvault::pub_from_priv(&invite_params.pk)?;

        AuthInvite::notify(&token)?;

        Transact::add_action_to_transaction(
            reject::ACTION_NAME,
            &reject {
                inviteKey: keyvault::to_der(&invite_pubkey)?.into(),
            }
            .packed(),
        )?;

        Ok(())
    }

    fn decode_invite(token: InviteToken) -> Result<Invite, CommonTypes::Error> {
        let invite_params = InviteParams::try_from_invite_id(&token)?;

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
            .ok_or(DatetimeError("decode_invite"))?
            .to_string();
        let state = match invite.state {
            0 => InviteState::Pending,
            1 => InviteState::Accepted,
            2 => InviteState::Rejected,
            _ => {
                return Err(InvalidInviteState("decode_invite").into());
            }
        };

        Ok(Invite {
            inviter: invite.inviter.to_string(),
            app: invite_params.app,
            app_domain: invite_params.app_domain,
            state: state,
            actor: invite.actor.to_string(),
            expiry,
        })
    }
}

impl Inviter for InvitePlugin {
    fn generate_invite() -> Result<InviteToken, CommonTypes::Error> {
        let keypair = keyvault::generate_unmanaged_keypair()?;

        Transact::add_action_to_transaction(
            createInvite::ACTION_NAME,
            &createInvite {
                inviteKey: keyvault::to_der(&keypair.public_key)?.into(),
            }
            .packed(),
        )?;

        let sender_app = Client::get_sender_app();

        let params = InviteParams {
            app: sender_app.app,
            app_domain: sender_app.origin,
            pk: keypair.private_key,
        };

        Ok(InviteToken::from(params))
    }

    fn delete_invite(token: InviteToken) -> Result<(), CommonTypes::Error> {
        let invite_keys = Self::deserialize(token)?;

        Transact::add_action_to_transaction(
            "delInvite",
            &InviteService::action_structs::delInvite {
                inviteKey: invite_keys.pub_key.into(),
            }
            .packed(),
        )?;

        Ok(())
    }
}

impl Advanced for InvitePlugin {
    fn deserialize(token: InviteToken) -> Result<InviteKeys, CommonTypes::Error> {
        let invite_params = InviteParams::try_from_invite_id(&token)?;
        let invite_pubkey: Pem = keyvault::pub_from_priv(&invite_params.pk)?;

        Ok(InviteKeys {
            pub_key: keyvault::to_der(&invite_pubkey)?,
            priv_key: keyvault::to_der(&invite_params.pk)?,
        })
    }
}

bindings::export!(InvitePlugin with_types_in bindings);
