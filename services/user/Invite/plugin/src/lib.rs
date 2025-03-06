#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;
use errors::ErrorType::*;

mod types;
use types::*;

mod db;
use db::*;

use accounts::{
    account_tokens::{api::serialize_token, types::*},
    plugin as Accounts,
};

use aes::plugin as aes;
use auth_invite::plugin::intf as AuthInvite;
use auth_sig::plugin::keyvault;
use bindings::invite::plugin::types::{Invite, InviteState};
use chrono::{DateTime, SecondsFormat};
use exports::{
    invite::{
        self,
        plugin::advanced::{Guest as Advanced, InvKeys as InviteKeys},
    },
    transact_hook_actions_sender::Guest as HookActionsSender,
};
use hex;
use host::common::{client as Client, server as Server, types as CommonTypes};
use invite::plugin::{invitee::Guest as Invitee, inviter::Guest as Inviter};
use psibase::{
    fracpack::Pack,
    services::invite::{self as InviteService, action_structs::*},
};
use rand::Rng;
use transact::plugin::{hooks::*, intf as Transact};

/* TODO:
    /// This doesn't need to be exposed, it can just be jammed into various plugin functions
    /// when the user is submitting another action anyways.
    /// Used by anyone to garbage collect expired invites. Up to 'maxDeleted' invites
    /// can be deleted by calling this action
    void delExpired(uint32_t maxDeleted);
*/

fn rand_bytes(nr_bytes: u32) -> Vec<u8> {
    let mut result = vec![0u8; nr_bytes as usize];
    let mut rng = rand::rng();
    rng.fill(&mut result[..]);
    result
}

struct InvitePlugin;

fn fetch_and_decode(token: &InviteToken) -> Result<InviteRecordSubset, CommonTypes::Error> {
    let id = token.id;

    if let Some(invite) = InvitesTable::get_invite(id) {
        return Ok(invite);
    }

    let query = format!(
        r#"query {{
            getInviteById(id: {id}) {{
                pubkey,
                inviter,
                app,
                appDomain,
                actor,
                expiry,
                state,
                secret,
            }}
        }}"#,
        id = id
    );
    let invite = InviteRecordSubset::from_gql(Server::post_graphql_get_json(&query)?)?;
    InvitesTable::add_invite(id, &invite);
    Ok(invite)
}

impl Invitee for InvitePlugin {
    fn accept_with_new_account(account: String, token: String) -> Result<(), CommonTypes::Error> {
        let accepted_by = psibase::AccountNumber::from_exact(&account).or_else(|_| {
            return Err(InvalidAccount(&account));
        })?;

        if Accounts::api::get_account(&account)?.is_some() {
            return Err(AccountExists("accept_with_new_account").into());
        }

        hook_actions_sender();

        AuthInvite::notify(&token)?;

        let invite_token = InviteToken::from_encoded(&token)?;
        let invite = fetch_and_decode(&invite_token)?;
        let invite_pubkey = invite.pubkey;

        Transact::add_action_to_transaction(
            acceptCreate::ACTION_NAME,
            &acceptCreate {
                inviteKey: keyvault::to_der(&invite_pubkey)?.into(),
                acceptedBy: accepted_by,
                newAccountKey: keyvault::to_der(&keyvault::generate_keypair()?)?.into(),
            }
            .packed(),
        )?;

        InvitesTable::delete_invite(invite_token.id);

        Ok(())
    }

    fn accept(token: String) -> Result<(), CommonTypes::Error> {
        let invite_token = InviteToken::from_encoded(&token)?;

        let invite = fetch_and_decode(&invite_token)?;
        let invite_pubkey = invite.pubkey;

        AuthInvite::notify(&token)?;

        Transact::add_action_to_transaction(
            accept::ACTION_NAME,
            &accept {
                inviteKey: keyvault::to_der(&invite_pubkey)?.into(),
            }
            .packed(),
        )?;

        InvitesTable::delete_invite(invite_token.id);

        Ok(())
    }

    fn reject(token: String) -> Result<(), CommonTypes::Error> {
        let invite_token = InviteToken::from_encoded(&token)?;
        let invite = fetch_and_decode(&invite_token)?;
        let invite_pubkey = invite.pubkey;

        hook_actions_sender();

        AuthInvite::notify(&token)?;

        Transact::add_action_to_transaction(
            reject::ACTION_NAME,
            &reject {
                inviteKey: keyvault::to_der(&invite_pubkey)?.into(),
            }
            .packed(),
        )?;

        InvitesTable::delete_invite(invite_token.id);

        Ok(())
    }

    fn decode_invite(token: String) -> Result<Invite, CommonTypes::Error> {
        let invite_token = InviteToken::from_encoded(&token)?;
        let invite = fetch_and_decode(&invite_token)?;

        let expiry = DateTime::parse_from_rfc3339(&invite.expiry)
            .map_err(|_| DatetimeError("decode_invite"))?
            .to_rfc3339_opts(SecondsFormat::Millis, true);
        let state = match invite.state {
            0 => InviteState::Pending,
            1 => InviteState::Accepted,
            2 => InviteState::Rejected,
            _ => {
                return Err(InvalidInviteState("decode_invite").into());
            }
        };

        let app = invite.app.map(|app| app.to_string());

        let app_domain = if invite.app_domain.is_none() {
            if app.is_none() {
                return Err(InvalidInvite("decode_invite").into());
            } else {
                Client::get_app_url(&app.clone().unwrap())
            }
        } else {
            invite.app_domain.unwrap().to_string()
        };

        Ok(Invite {
            inviter: invite.inviter.to_string(),
            app,
            app_domain,
            state: state,
            actor: invite.actor.to_string(),
            expiry,
        })
    }
}

impl Inviter for InvitePlugin {
    fn generate_invite() -> Result<String, CommonTypes::Error> {
        let keypair = keyvault::generate_unmanaged_keypair()?;

        let seed = rand_bytes(8);
        let encrypted_private_key =
            aes::with_password::encrypt(&seed, keypair.private_key.as_bytes());
        let encrypted_private_key_hex = hex::encode(&encrypted_private_key);

        let sender_app = Client::get_sender_app();
        let app = match sender_app.app {
            Some(app_str) => match psibase::AccountNumber::from_exact(&app_str) {
                Ok(account) => Some(account),
                Err(_) => return Err(InvalidAccount(&app_str).into()),
            },
            None => None,
        };

        let id: u32 = rand::rng().random();
        Transact::add_action_to_transaction(
            createInvite::ACTION_NAME,
            &createInvite {
                inviteKey: keyvault::to_der(&keypair.public_key)?.into(),
                id: Some(id),
                app,
                appDomain: Some(sender_app.origin),
                secret: Some(encrypted_private_key_hex),
            }
            .packed(),
        )?;

        let seed_u64 = u64::from_le_bytes(seed.as_slice().try_into().unwrap());
        let invite_token = InviteToken { pk: seed_u64, id };

        Ok(serialize_token(&Token::InviteToken(invite_token)))
    }

    fn delete_invite(token: String) -> Result<(), CommonTypes::Error> {
        let invite_token = InviteToken::from_encoded(&token)?;
        let invite = fetch_and_decode(&invite_token)?;
        let invite_pubkey = invite.pubkey;

        Transact::add_action_to_transaction(
            "delInvite",
            &InviteService::action_structs::delInvite {
                inviteKey: keyvault::to_der(&invite_pubkey)?.into(),
            }
            .packed(),
        )?;

        Ok(())
    }
}

impl Advanced for InvitePlugin {
    fn deserialize(token: String) -> Result<InviteKeys, CommonTypes::Error> {
        let invite_token = InviteToken::from_encoded(&token)?;
        let invite = fetch_and_decode(&invite_token)?;

        let encrypted_private_key_hex = invite
            .secret
            .ok_or_else(|| DecodeInviteError("No secret in invite record"))?;
        let encrypted_private_key = hex::decode(&encrypted_private_key_hex).unwrap();

        let private_key_pem_bytes =
            aes::with_password::decrypt(&invite_token.pk.to_le_bytes(), &encrypted_private_key)?;
        let private_key_pem = String::from_utf8(private_key_pem_bytes)
            .map_err(|_| DecodeInviteError("Failed to decode encrypted private key"))?;

        Ok(InviteKeys {
            pub_key: keyvault::to_der(&keyvault::pub_from_priv(&private_key_pem)?)?,
            priv_key: keyvault::to_der(&private_key_pem)?,
        })
    }
}

impl HookActionsSender for InvitePlugin {
    fn on_actions_sender(
        service: String,
        method: String,
    ) -> Result<Option<String>, CommonTypes::Error> {
        if service == InviteService::SERVICE.to_string()
            && (method == acceptCreate::ACTION_NAME || method == reject::ACTION_NAME)
        {
            return Ok(Some(InviteService::PAYER_ACCOUNT.to_string()));
        }

        Ok(None)
    }
}

bindings::export!(InvitePlugin with_types_in bindings);
