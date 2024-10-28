use crate::bindings::accounts::plugin::accounts::{get_account, get_logged_in_user};
use crate::bindings::accounts::smart_auth::smart_auth::{
    self as SmartAuth, Action as PartialAction,
};
use crate::bindings::host::common as Host;
use crate::errors::ErrorType::*;
use crate::types::FromExpirationTime;
use crate::AuthPlugins;
use psibase::fracpack::Pack;
use psibase::{
    services, services::invite::action_structs as InviteService, AccountNumber, Hex, MethodNumber,
    SignedTransaction, Tapos, Transaction,
};

use regex::Regex;
use sha2::{Digest, Sha256};

pub fn validate_action_name(action_name: &str) -> Result<(), Host::types::Error> {
    let re = Regex::new(r"^[a-zA-Z0-9_]+$").unwrap();
    if re.is_match(action_name) {
        return Ok(());
    }
    Err(InvalidActionName.err(action_name))
}

pub fn assert_from_supervisor() {
    let sender_app = Host::client::get_sender_app()
        .app
        .expect("Sender app not set");
    assert!(sender_app == "supervisor", "Unauthorized");
}

fn inject_sender(actions: Vec<PartialAction>, sender: AccountNumber) -> Vec<psibase::Action> {
    actions
        .into_iter()
        .map(|a| psibase::Action {
            sender,
            service: AccountNumber::from(a.service.as_str()),
            method: MethodNumber::from(a.method.as_str()),
            rawData: Hex::from(a.raw_data.clone()),
        })
        .collect()
}

// The auth service can parameterize what claims to add to a transaction by both the sender
//   and the actions in the transaction.
// The auth service is therefore the only service other than transact that gets to see
//   in full what actions are being taken by a user.
fn get_claims(
    sender: &AccountNumber,
    actions: &[PartialAction],
) -> Result<Vec<SmartAuth::Claim>, Host::types::Error> {
    let sender_str = sender.to_string();

    // Get claims from their auth service
    let auth_service_acc = get_account(&sender_str)?.unwrap().auth_service;
    let plugin_ref = Host::types::PluginRef::new(&auth_service_acc);
    let mut claims = SmartAuth::get_claims(plugin_ref, &sender_str, actions)?;

    // Also get claims from any auth notifiers
    let auth_plugins = AuthPlugins::get();
    for plugin in auth_plugins {
        if plugin == auth_service_acc {
            continue;
        }

        let plugin_ref = Host::types::PluginRef::new(&plugin);

        // An auth notifier should not be privy to the full action list, only its own actions
        //   (like every other plugin).
        let action_subset: Vec<PartialAction> = actions
            .iter()
            .filter(|&a| a.service == plugin)
            .cloned()
            .collect();

        let mut c = SmartAuth::get_claims(plugin_ref, &sender_str, &action_subset)?;
        claims.append(&mut c);
    }

    Ok(claims)
}

pub fn make_transaction(
    actions: Vec<SmartAuth::Action>,
    sender: AccountNumber,
    expiration_seconds: u64,
) -> Transaction {
    let claims = get_claims(&sender, &actions).expect("Failed to retrieve claims from auth plugin");
    let claims: Vec<psibase::Claim> = claims.into_iter().map(Into::into).collect();
    let actions = inject_sender(actions, sender);

    let t = Transaction {
        tapos: Tapos::from_expiration_time(expiration_seconds),
        actions,
        claims,
    };
    println!(
        "Publishing transaction: \n{}",
        serde_json::to_string_pretty(&t).unwrap()
    );
    t
}

pub fn get_tx_sender(actions: &[PartialAction]) -> Result<AccountNumber, Host::types::Error> {
    let sender = get_logged_in_user()?;
    if sender.is_none() {
        if actions.len() == 1 {
            let a = &actions[0];
            if AccountNumber::from(a.service.as_str()) == services::invite::SERVICE
                && (a.method == InviteService::acceptCreate::ACTION_NAME
                    || a.method == InviteService::reject::ACTION_NAME)
            {
                return Ok(services::invite::PAYER_ACCOUNT);
            }
        }
    }

    if sender.is_none() {
        return Err(NotLoggedIn.err("get_tx_sender"));
    }

    Ok(AccountNumber::from(sender.unwrap().as_str()))
}

pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

pub fn get_proofs(
    sender: &AccountNumber,
    tx_hash: &[u8; 32],
) -> Result<Vec<Hex<Vec<u8>>>, Host::types::Error> {
    let sender_str = sender.to_string();

    // Get proofs from the sender's auth service
    let auth_service_acc = get_account(&sender_str)?.unwrap().auth_service;
    let plugin_ref = Host::types::PluginRef::new(&auth_service_acc);
    let mut proofs = SmartAuth::get_proofs(plugin_ref, &sender_str, tx_hash)?;

    // Also get proofs from any auth notifiers
    let auth_plugins = AuthPlugins::get();
    for plugin in auth_plugins {
        if plugin == auth_service_acc {
            continue;
        }

        let plugin_ref = Host::types::PluginRef::new(&plugin);
        let mut p = SmartAuth::get_proofs(plugin_ref, &sender_str, tx_hash)?;
        proofs.append(&mut p);
    }
    AuthPlugins::clear();

    Ok(proofs
        .into_iter()
        .map(|proof| Hex::from(proof.signature))
        .collect())
}

pub trait Publish {
    fn publish(self) -> Result<String, Host::types::Error>;
}

impl Publish for SignedTransaction {
    fn publish(self) -> Result<String, Host::types::Error> {
        Ok(Host::server::post(&Host::types::PostRequest {
            endpoint: "/push_transaction".to_string(),
            body: Host::types::BodyTypes::Bytes(self.packed()),
        })?)
    }
}
