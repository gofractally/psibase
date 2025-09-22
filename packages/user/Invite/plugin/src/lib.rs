#![allow(non_snake_case)]

#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;
use errors::ErrorType::*;

mod types;
use chrono::{DateTime, Utc};
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
use psibase::define_trust;
use psibase::{
    fracpack::Pack,
    services::credentials::CREDENTIAL_SENDER,
    services::invite::{self as InviteService, action_structs::*},
};
use rand::{rngs::OsRng, Rng, TryRngCore};
use transact::plugin::{hooks::*, intf as Transact};

use crate::{bindings::credentials::plugin::types::Credential, trust::is_authorized};

define_trust! {
    descriptions {
        Low => "
        Low trust grants these abilities:
            - Delete previously created invites
        ",
        Medium => "Medium trust grants all the abilities of low trust, plus these abilities:
            - Generate new invites
        ",
        High => "",
    }
    functions {
        None => [import_invite_token, prepare_new_invite],
        Low => [delete_invite],
        Medium => [generate_invite],
        High => [],
    }
}

struct InvitePlugin;

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

impl Invitee for InvitePlugin {
    fn import_invite_token(token: String) -> Result<u32, HostTypes::Error> {
        if !is_authorized(trust::FunctionName::import_invite_token)? {
            return Err(Unauthorized().into());
        }
        let imported = InviteTokensTable::import(token);
        if imported.is_none() {
            return Err(InviteNotValid().into());
        }
        Ok(imported.unwrap())
    }

    // This is shorthand for calling `import-invite-token` and then immediately
    // attempting to connect a new account to the caller app.
    // fn consume_invite_token(token: String) -> Result<(), HostTypes::Error> {
    //     assert!(Client::get_sender() == Client::get_active_app());
    //     validate_invite_token(&token)?;
    //     InviteTokensTable::import(token);
    //     // TODO - call connect() on accounts app.
    //     Ok(())
    // }
}

fn use_active_invite() {
    hook_actions_sender();

    let cred_private_key = InviteTokensTable::active_credential_key().unwrap();
    let cred_public_key = keyvault::pub_from_priv(&cred_private_key).unwrap();

    Credentials::sign_latch(&Credential {
        p256_pub: keyvault::to_der(&cred_public_key).unwrap(),
        p256_priv: keyvault::to_der(&cred_private_key).unwrap(),
    });
}

impl Redemption for InvitePlugin {
    fn get_active_invite() -> Option<bool> {
        assert!(Client::get_sender() == psibase::services::accounts::SERVICE.to_string());

        let token = InviteTokensTable::active_invite_id();
        if token.is_none() {
            return None;
        }

        Some(InviteTokensTable::active_can_create_account())
    }

    fn create_new_account(account: String) -> String {
        assert!(Client::get_sender() == psibase::services::accounts::SERVICE.to_string());

        assert!(
            InviteTokensTable::active_can_create_account(),
            "Active invite token cannot be used to create an account"
        );

        use_active_invite();

        let new_account_keys = keyvault::generate_unmanaged_keypair().unwrap();
        let new_acc_pubkey = keyvault::import_key(&new_account_keys.private_key).unwrap();

        Transact::add_action_to_transaction(
            createAccount::ACTION_NAME,
            &createAccount {
                account: psibase::AccountNumber::from_exact(&account).unwrap(),
                accountKey: keyvault::to_der(&new_acc_pubkey).unwrap().into(),
            }
            .packed(),
        )
        .unwrap();

        InviteTokensTable::account_created();

        new_account_keys.private_key
    }

    fn accept() {
        assert!(Client::get_sender() == psibase::services::accounts::SERVICE.to_string());

        use_active_invite();

        Transact::add_action_to_transaction(accept::ACTION_NAME, &accept {}.packed()).unwrap();

        InviteTokensTable::accepted();
    }
}

impl Inviter for InvitePlugin {
    fn generate_invite() -> Result<String, HostTypes::Error> {
        if !is_authorized(trust::FunctionName::generate_invite)? {
            return Err(Unauthorized().into());
        }
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
        if !is_authorized(trust::FunctionName::prepare_new_invite)? {
            return Err(Unauthorized().into());
        }
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
        if !is_authorized(trust::FunctionName::delete_invite)? {
            return Err(Unauthorized().into());
        }
        let decoded = InviteTokensTable::decode_invite_token(token)?;
        Transact::add_action_to_transaction(
            delInvite::ACTION_NAME,
            &delInvite {
                inviteId: decoded.0,
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
            && (method == createAccount::ACTION_NAME || method == accept::ACTION_NAME)
        {
            return Ok(Some(CREDENTIAL_SENDER.to_string()));
        }

        Ok(None)
    }
}

bindings::export!(InvitePlugin with_types_in bindings);
