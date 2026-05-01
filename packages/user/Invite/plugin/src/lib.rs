#![allow(non_snake_case)]

#[allow(warnings)]
mod bindings;
use std::str::FromStr;

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
use bindings::{
    aes::plugin as aes, base64::plugin as base64, credentials::plugin as credentials,
    tokens::plugin as tokens, transact::plugin as transact,
};
use invite::plugin::{
    invitee::Guest as Invitee,
    inviter::{Guest as Inviter, InviteDetails},
    redemption::Guest as Redemption,
};
use psibase::{
    fracpack::Pack,
    services::{
        credentials::CREDENTIAL_SENDER,
        invite::{self as Invite, InvPayload},
        tokens::{Decimal, Quantity},
    },
    AccountNumber, MethodNumber,
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
            medium: &["Generate (purchase) new invites"],
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

struct InviteDetailsInternal {
    details: InviteDetails,
    min_cost: String,
}

fn prepare_new_invite_impl(
    num_accounts: u16,
    service_name: String,
) -> Result<InviteDetailsInternal, Error> {
    let keypair = host::crypto::generate_unmanaged_keypair()?;
    let (symmetric_key, secret) = create_secret(keypair.private_key.as_bytes());

    let invite_id: u32 = rand::rng().random();
    let invite_token = encode_invite_token(invite_id, symmetric_key);

    let sys = tokens::helpers::fetch_network_token()?;
    let min_cost = if sys.is_some() {
        get_invite_cost(num_accounts)?
    } else {
        "0".to_string()
    };

    let fingerprint = psibase::sha256(&host::crypto::to_der(&keypair.public_key)?)
        .0
        .to_vec();

    let min_cost_u64 = Decimal::from_str(&min_cost).unwrap().quantity.value;
    if sys.is_some() && min_cost_u64 > 0 {
        tokens::user::credit(sys.unwrap(), &service_name, &min_cost, "Create an invite")?;
    }

    let payload = InvPayload {
        fingerprint,
        secret,
    }
    .packed();

    Ok(InviteDetailsInternal {
        details: InviteDetails {
            invite_token,
            invite_id,
            payload,
        },
        min_cost,
    })
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
        let app = host::client::get_active_app();
        let auth = trust::authorized_with_whitelist::<Self>(
            TrustLevel::Low,
            "reject_active_invite",
            &[app.as_str()],
        )
        .unwrap();
        if !auth {
            panic!("{}", trust::unauthorized_error("reject_active_invite"));
        }

        InviteTokensTable::reject_active();
    }
}

fn use_active_invite() {
    hook_actions_sender();

    credentials::api::use_p256_credential(&InviteTokensTable::active_credential_key().unwrap());
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

fn get_invite_cost(num_accounts: u16) -> Result<String, Error> {
    let query = format!(
        r#"query {{ getInviteCost(numAccounts: {}) }}"#,
        num_accounts
    );
    let response = host::server::post_graphql_get_json(&query)?;
    let cost = GetInviteCostResponse::from_gql(response)?;
    Ok(cost.getInviteCost)
}

impl Inviter for InvitePlugin {
    #[psibase_plugin::authorized(Medium, whitelist = ["homepage"])]
    fn generate_invite() -> Result<String, Error> {
        const NUM_ACCOUNTS: u16 = 1;
        let i = prepare_new_invite_impl(NUM_ACCOUNTS, Invite::SERVICE.to_string())?;

        let min_cost_u64 = Decimal::from_str(&i.min_cost).unwrap().quantity.value;

        Invite::Wrapper::add_to_tx().createInvite(
            i.details.invite_id,
            i.details.payload,
            NUM_ACCOUNTS,
            false,
            Quantity::from(min_cost_u64),
        );

        Ok(i.details.invite_token)
    }

    #[psibase_plugin::authorized(Medium, whitelist=["fractals"])]
    fn prepare_new_invite(num_accounts: u16, service_name: String) -> Result<InviteDetails, Error> {
        Ok(prepare_new_invite_impl(num_accounts, service_name)?.details)
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
        let create_account_method =
            MethodNumber::from(Invite::action_structs::createAccount::ACTION_NAME);
        if service == Invite::SERVICE.to_string()
            && MethodNumber::from(method.as_str()) == create_account_method
        {
            return Ok(Some(CREDENTIAL_SENDER.to_string()));
        } else {
            println!(
                "Action sender hook set, but {}:{} is not {}:{}",
                method,
                service,
                Invite::SERVICE.to_string(),
                Invite::action_structs::createAccount::ACTION_NAME
            );
        }

        Ok(None)
    }
}

bindings::export!(InvitePlugin with_types_in bindings);
