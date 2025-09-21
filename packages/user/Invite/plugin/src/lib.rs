#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;

mod types;
use types::*;

mod db;
use db::*;

use aes::plugin as aes;
use auth_sig::plugin::keyvault;
use base64::plugin as base64;
use bindings::invite::plugin::types::NewInviteDetails;
use credentials::plugin::api as Credentials;
use exports::{
    invite::{self},
    transact_hook_actions_sender::Guest as HookActionsSender,
};
use host::common::client as Client;
use host::common::server as Server;
use host::types::types as HostTypes;
use invite::plugin::{
    invitee::Guest as Invitee, inviter::Guest as Inviter, redemption::Guest as Redemption,
};
use psibase::{
    fracpack::Pack,
    services::credentials::CREDENTIAL_SENDER,
    services::invite::{self as InviteService, action_structs::*},
};
use rand::{rngs::OsRng, Rng, TryRngCore};
use transact::plugin::{hooks::*, intf as Transact};

use crate::bindings::credentials::plugin::types::Credential;

// TODO - check auth on all functions
struct InvitePlugin;

fn fetch_decrypt_secret(invite_id: u32, sym_key: Vec<u8>) -> String {
    let query = format!(
        r#"query {{
            inviteById(inviteId: "{id}") {{
                secret,
            }}
        }}"#,
        id = invite_id
    );
    let secret = SecretResponse::from_gql(Server::post_graphql_get_json(&query).unwrap())
        .unwrap()
        .secret;

    let cred_key = aes::with_key::decrypt(
        &aes::types::Key {
            strength: aes::types::Strength::Aes128,
            key_data: sym_key,
        },
        base64::standard::decode(&secret).unwrap().as_slice(),
    )
    .unwrap();
    String::from_utf8(cred_key).unwrap()
}

fn create_secret(private_data: &[u8]) -> (Vec<u8>, String) {
    let mut key = [0u8; 16];
    OsRng.try_fill_bytes(&mut key).unwrap();
    let encrypted = aes::with_key::encrypt(
        &aes::types::Key {
            strength: aes::types::Strength::Aes128,
            key_data: key.to_vec(),
        },
        private_data,
    );

    (key.to_vec(), base64::standard::encode(&encrypted))
}

fn encode_invite_token(invite_id: u32, symmetric_key: Vec<u8>) -> String {
    let mut data = invite_id.to_le_bytes().to_vec();
    data.extend_from_slice(&symmetric_key);
    assert!(data.len() == 20, "encryption key must be 16 bytes");
    base64::url::encode(data.as_slice())
}

fn decode_invite_token(token: String) -> Result<(u32, Vec<u8>), HostTypes::Error> {
    let data = base64::url::decode(&token)?;
    assert!(data.len() == 20, "invalid token");
    let invite_id = u32::from_le_bytes(data[..4].try_into().unwrap());
    let symmetric_key = &data[4..];

    Ok((invite_id, symmetric_key.to_vec()))
}

fn validate_invite_token(token: &str) -> Result<(), HostTypes::Error> {
    let _ = decode_invite_token(token.to_string())?;
    Ok(())
}

impl Invitee for InvitePlugin {
    fn import_invite_token(token: String) -> Result<(), HostTypes::Error> {
        validate_invite_token(&token)?;
        InviteTokensTable::import(token);
        Ok(())
    }

    fn consume_invite_token(token: String) -> Result<(), HostTypes::Error> {
        validate_invite_token(&token)?;
        InviteTokensTable::import(token);
        // TODO - call connect() on accounts app.
        Ok(())
    }
}

fn use_active_invite() {
    hook_actions_sender();

    let token = InviteTokensTable::get_active_token().expect("No active invite token");
    let (invite_id, sym_key) = decode_invite_token(token).unwrap();
    let cred_private_key = fetch_decrypt_secret(invite_id, sym_key);
    let cred_public_key = keyvault::pub_from_priv(&cred_private_key).unwrap();

    Credentials::sign_latch(&Credential {
        p256_pub: keyvault::to_der(&cred_public_key).unwrap(),
        p256_priv: keyvault::to_der(&cred_private_key).unwrap(),
    });
}

impl Redemption for InvitePlugin {
    fn is_active_invite() -> bool {
        let token = InviteTokensTable::get_active_token();
        token.is_some()
    }

    fn accept_with_new_account(account: String) -> String {
        assert!(Client::get_sender() == psibase::services::accounts::SERVICE.to_string());

        use_active_invite();

        let new_account_keys = keyvault::generate_unmanaged_keypair().unwrap();
        let new_acc_pubkey = keyvault::import_key(&new_account_keys.private_key).unwrap();

        Transact::add_action_to_transaction(
            acceptCreate::ACTION_NAME,
            &acceptCreate {
                acceptedBy: psibase::AccountNumber::from_exact(&account).unwrap(),
                newAccountKey: keyvault::to_der(&new_acc_pubkey).unwrap().into(),
            }
            .packed(),
        )
        .unwrap();

        InviteTokensTable::consume_active();

        new_account_keys.private_key
    }

    fn accept() {
        assert!(Client::get_sender() == psibase::services::accounts::SERVICE.to_string());

        use_active_invite();

        Transact::add_action_to_transaction(accept::ACTION_NAME, &accept {}.packed()).unwrap();

        InviteTokensTable::consume_active();
    }
}

impl Inviter for InvitePlugin {
    fn generate_invite() -> Result<String, HostTypes::Error> {
        let (invite_token, details) = Self::prepare_new_invite()?;

        Transact::add_action_to_transaction(
            createInvite::ACTION_NAME,
            &createInvite {
                id: details.invite_id,
                inviteKey: details.invite_key.into(),
                numAccounts: 1,
                useHooks: false,
                secret: details.encrypted_secret,
            }
            .packed(),
        )?;

        Ok(invite_token)
    }

    fn prepare_new_invite() -> Result<(String, NewInviteDetails), HostTypes::Error> {
        let keypair = keyvault::generate_unmanaged_keypair()?;
        let (symmetric_key, secret) = create_secret(keypair.private_key.as_bytes());

        let invite_id: u32 = rand::rng().random();
        let invite_token = encode_invite_token(invite_id, symmetric_key);

        Ok((
            invite_token,
            NewInviteDetails {
                invite_id,
                invite_key: keyvault::to_der(&keypair.public_key)?,
                encrypted_secret: secret,
            },
        ))
    }

    fn delete_invite(token: String) -> Result<(), HostTypes::Error> {
        Transact::add_action_to_transaction(
            delInvite::ACTION_NAME,
            &delInvite {
                inviteId: decode_invite_token(token)?.0,
            }
            .packed(),
        )?;

        Ok(())
    }
}

impl HookActionsSender for InvitePlugin {
    fn on_actions_sender(
        service: String,
        method: String,
    ) -> Result<Option<String>, HostTypes::Error> {
        if service == InviteService::SERVICE.to_string()
            && (method == acceptCreate::ACTION_NAME || method == accept::ACTION_NAME)
        {
            return Ok(Some(CREDENTIAL_SENDER.to_string()));
        }

        Ok(None)
    }
}

bindings::export!(InvitePlugin with_types_in bindings);
