#![allow(non_snake_case)]

#[allow(warnings)]
mod bindings;

mod errors;
use errors::ErrorTypes::*;

mod types;
use chrono::{DateTime, Utc};
use types::*;

mod db;
use db::*;

use bindings::exports::{
    invite::{self},
    transact_hook_actions_sender::Guest as HookActionsSender,
};
use bindings::invite::plugin::types::NewInviteDetails;
use bindings::{
    aes::plugin as aes, base64::plugin as base64, credentials::plugin as credentials,
    transact::plugin as transact,
};
use invite::plugin::{
    invitee::Guest as Invitee, inviter::Guest as Inviter, redemption::Guest as Redemption,
};
use psibase::{
    fracpack::Pack,
    services::{credentials::CREDENTIAL_SENDER, invite as Invite},
    AccountNumber,
};
use transact::hooks::*;

use rand::{rngs::OsRng, Rng, TryRngCore};

use psibase_plugin::{
    trust::{self, *},
    *,
};

struct InvitePlugin;

impl TrustConfig for InvitePlugin {
    fn capabilities() -> Capabilities {
        Capabilities {
            low: &["Delete previously created invites", "Reject active invites"],
            medium: &["Generate new invites"],
            high: &[""],
        }
    }
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

impl Invitee for InvitePlugin {
    #[psibase_plugin::authorized(None)]
    fn import_invite_token(token: String) -> Result<u32, Error> {
        let imported = InviteTokensTable::import(token);
        if imported.is_none() {
            return Err(InviteNotValid.into());
        }
        Ok(imported.unwrap())
    }

    /// Returns whether or not an invite from someone is active for the caller
    /// application
    #[psibase_plugin::authorized(None)]
    fn is_active_invite() -> bool {
        InviteTokensTable::active_invite_id().is_some()
    }

    /// If there is an active invite, reject it
    fn reject_active_invite() {
        trust::assert_authorized_with_whitelist::<Self>(
            TrustLevel::Low,
            "reject_active_invite",
            &vec![host::client::get_active_app()],
        )
        .unwrap();

        InviteTokensTable::reject_active();
    }
}

fn use_active_invite() {
    hook_actions_sender();

    let cred_private_key = InviteTokensTable::active_credential_key().unwrap();
    let cred_public_key = host::crypto::pub_from_priv(&cred_private_key).unwrap();

    credentials::api::sign_latch(&credentials::types::Credential {
        p256_pub: host::crypto::to_der(&cred_public_key).unwrap(),
        p256_priv: host::crypto::to_der(&cred_private_key).unwrap(),
    });
}

impl Redemption for InvitePlugin {
    fn get_active_invite() -> Option<bool> {
        assert!(host::client::get_sender() == psibase::services::accounts::SERVICE.to_string());

        let token = InviteTokensTable::active_invite_id();
        if token.is_none() {
            return None;
        }

        Some(InviteTokensTable::active_can_create_account())
    }

    fn create_new_account(account: String) -> String {
        assert!(host::client::get_sender() == psibase::services::accounts::SERVICE.to_string());

        assert!(
            InviteTokensTable::active_can_create_account(),
            "Active invite token cannot be used to create an account"
        );

        use_active_invite();

        let new_account_keys = host::crypto::generate_unmanaged_keypair().unwrap();
        let new_acc_pubkey = host::crypto::import_key(&new_account_keys.private_key).unwrap();

        let account = AccountNumber::from_exact(&account).unwrap();
        let key = host::crypto::to_der(&new_acc_pubkey).unwrap().into();
        Invite::Wrapper::add_to_tx().createAccount(account, key);

        InviteTokensTable::account_created();

        new_account_keys.private_key
    }

    fn accept() {
        assert!(host::client::get_sender() == psibase::services::accounts::SERVICE.to_string());

        use_active_invite();

        let Some(inviteId) = InviteTokensTable::active_invite_id() else {
            println!("No active invite token");
            return;
        };

        Invite::Wrapper::add_to_tx().accept(inviteId);

        InviteTokensTable::accepted();
    }
}

impl Inviter for InvitePlugin {
    #[psibase_plugin::authorized(Medium, whitelist = ["homepage"])]
    fn generate_invite() -> Result<String, Error> {
        let (invite_token, d) = Self::prepare_new_invite()?;

        const NUM_ACCOUNTS: u16 = 1;
        Invite::Wrapper::add_to_tx().createInvite(
            d.invite_id,
            d.invite_key.into(),
            NUM_ACCOUNTS,
            false,
            d.encrypted_secret,
        );

        Ok(invite_token)
    }

    #[psibase_plugin::authorized(None)]
    fn prepare_new_invite() -> Result<(String, NewInviteDetails), Error> {
        let keypair = host::crypto::generate_unmanaged_keypair()?;
        let (symmetric_key, secret) = create_secret(keypair.private_key.as_bytes());

        let invite_id: u32 = rand::rng().random();
        let invite_token = encode_invite_token(invite_id, symmetric_key);

        Ok((
            invite_token,
            NewInviteDetails {
                invite_id,
                invite_key: host::crypto::to_der(&keypair.public_key)?,
                encrypted_secret: secret,
            },
        ))
    }

    #[psibase_plugin::authorized(Low)]
    fn delete_invite(token: String) -> Result<(), Error> {
        let decoded = InviteTokensTable::decode_invite_token(token)?;
        Invite::Wrapper::add_to_tx().delInvite(decoded.0);

        Ok(())
    }
}

impl HookActionsSender for InvitePlugin {
    fn on_actions_sender(service: String, method: String) -> Result<Option<String>, Error> {
        if service == Invite::SERVICE.to_string()
            && method == Invite::action_structs::createAccount::ACTION_NAME
        {
            return Ok(Some(CREDENTIAL_SENDER.to_string()));
        }

        Ok(None)
    }
}

bindings::export!(InvitePlugin with_types_in bindings);
