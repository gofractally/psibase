use crate::bindings::accounts::plugin::api::get_account;
use crate::bindings::accounts::plugin::api::get_current_user;
use crate::bindings::host::common as Host;
use crate::bindings::host::crypto::keyvault as HostCrypto;
use crate::bindings::host::types::types::{self as HostTypes, BodyTypes, PluginRef};
use crate::bindings::transact::plugin::hook_handlers::*;
use crate::bindings::transact::plugin::types::{Action, Claim};
use crate::errors::ErrorType::*;
use crate::types::FromExpirationTime;
use crate::{ActionSenderHook, ProposeLatch, TxSignatures};
use psibase::fracpack::Pack;
use psibase::{Hex, MethodNumber, SignedTransaction, Tapos, Transaction};
use serde::Serialize;
use Host::server as Server;

use regex::Regex;
use sha2::{Digest, Sha256};

pub fn validate_action_name(action_name: &str) -> Result<(), HostTypes::Error> {
    let re = Regex::new(r"^([a-zA-Z0-9_]+|#[a-z]{16})$").unwrap();
    if re.is_match(action_name) {
        return Ok(());
    }
    Err(InvalidActionName(action_name).into())
}

pub fn get_action_sender(service: &str, method: &str) -> Result<String, HostTypes::Error> {
    if let Some(sender) = ProposeLatch::subsequent_action_sender() {
        return Ok(sender);
    }
    if let Some(plugin) = ActionSenderHook::get() {
        if let Some(s) = on_actions_sender(
            PluginRef::new(plugin.as_str(), "plugin", "transact-hook-actions-sender"),
            service,
            method,
        )? {
            return Ok(s);
        }
    }
    if let Some(sender) = get_current_user() {
        return Ok(sender);
    }

    Err(NotLoggedIn("get_action_sender").into())
}

impl From<Action> for psibase::Action {
    fn from(action: Action) -> Self {
        psibase::Action {
            sender: action.sender.parse().unwrap(),
            service: action.service.parse().unwrap(),
            method: MethodNumber::from(action.method.as_str()),
            rawData: action.raw_data.into(),
        }
    }
}

pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

pub fn sign_with_claim(claim: &Claim, tx_hash: &[u8]) -> Result<Vec<u8>, HostTypes::Error> {
    HostCrypto::sign(tx_hash, &claim.raw_data)
}

// User auth claims come from hook-user-auth. Extra signatures added via
// add-signature (e.g. invite credentials) are appended after.
pub fn get_claims(actions: &[Action]) -> Result<Vec<Claim>, HostTypes::Error> {
    if actions.is_empty() {
        return Ok(vec![]);
    }

    let mut claims = vec![];

    if let Some(user) = get_current_user() {
        let auth_service_acc = get_account(&user)?.unwrap().auth_service;
        let plugin_ref = PluginRef::new(&auth_service_acc, "plugin", "transact-hook-user-auth");
        if let Some(claim) = on_user_auth_claim(plugin_ref, &user)? {
            claims.push(claim);
        }
    }

    TxSignatures::with(|extra| {
        for c in extra {
            claims.push(Claim {
                verify_service: c.verify_service.clone(),
                raw_data: c.raw_data.clone(),
            });
        }
    });

    Ok(claims)
}

pub fn get_claims_for_user(user: &String) -> Result<Vec<Claim>, HostTypes::Error> {
    let mut claims = vec![];

    let auth_service_acc = get_account(user)?.unwrap().auth_service;
    let plugin_ref = PluginRef::new(&auth_service_acc, "plugin", "transact-hook-user-auth");
    if let Some(claim) = on_user_auth_claim(plugin_ref, &user)? {
        claims.push(claim);
    }

    Ok(claims)
}

pub fn get_proofs(tx_hash: &[u8; 32]) -> Result<Vec<Hex<Vec<u8>>>, HostTypes::Error> {
    let mut proofs = vec![];

    if let Some(user) = get_current_user() {
        let auth_service_acc = get_account(&user)?.unwrap().auth_service;
        let plugin_ref = PluginRef::new(&auth_service_acc, "plugin", "transact-hook-user-auth");
        if let Some(proof) = on_user_auth_proof(plugin_ref, &user, tx_hash)? {
            proofs.push(Hex::from(proof.signature));
        }
    }

    let extra_proofs = TxSignatures::with(|extra| -> Result<Vec<Hex<Vec<u8>>>, HostTypes::Error> {
        extra
            .iter()
            .map(|claim| sign_with_claim(claim, tx_hash).map(Hex::from))
            .collect()
    })?;
    proofs.extend(extra_proofs);

    Ok(proofs)
}

pub fn get_proofs_for_user(
    tx_hash: &[u8; 32],
    user: &String,
) -> Result<Vec<Hex<Vec<u8>>>, HostTypes::Error> {
    let mut proofs = vec![];

    let auth_service_acc = get_account(user)?.unwrap().auth_service;
    let plugin_ref = PluginRef::new(&auth_service_acc, "plugin", "transact-hook-user-auth");
    if let Some(proof) = on_user_auth_proof(plugin_ref, &user, tx_hash)? {
        proofs.push(proof);
    }

    Ok(proofs
        .into_iter()
        .map(|proof| Hex::from(proof.signature))
        .collect())
}

#[derive(Serialize)]
struct SimpleAction {
    sender: String,
    service: String,
    method: String,
}

impl From<psibase::Action> for SimpleAction {
    fn from(action: psibase::Action) -> Self {
        SimpleAction {
            sender: action.sender.to_string(),
            service: action.service.to_string(),
            method: action.method.to_string(),
        }
    }
}

#[derive(Serialize)]
struct SimpleClaim {
    service: String,
}

impl From<psibase::Claim> for SimpleClaim {
    fn from(claim: psibase::Claim) -> Self {
        SimpleClaim {
            service: claim.service.to_string(),
        }
    }
}

#[derive(Serialize)]
struct SimpleTx {
    actions: Vec<SimpleAction>,
    claims: Vec<SimpleClaim>,
}

impl From<Transaction> for SimpleTx {
    fn from(tx: Transaction) -> Self {
        SimpleTx {
            actions: tx.actions.into_iter().map(Into::into).collect(),
            claims: tx.claims.into_iter().map(Into::into).collect(),
        }
    }
}

pub fn make_transaction(actions: Vec<Action>, expiration_seconds: u64) -> Transaction {
    let claims = get_claims(&actions).expect("Failed to retrieve claims from auth plugin");
    let claims: Vec<psibase::Claim> = claims.into_iter().map(Into::into).collect();

    let actions: Vec<psibase::Action> = actions.into_iter().map(Into::into).collect();

    let tapos = Tapos::from_expiration_time(expiration_seconds);

    let t = Transaction {
        tapos,
        actions,
        claims,
    };

    let simple_tx: SimpleTx = t.clone().into();

    println!(
        "Publishing transaction: \n{}",
        serde_json::to_string_pretty(&simple_tx).unwrap()
    );
    t
}

pub trait Publish {
    fn publish(self) -> Result<BodyTypes, HostTypes::Error>;
}

impl Publish for SignedTransaction {
    fn publish(self) -> Result<BodyTypes, HostTypes::Error> {
        Ok(Server::post(&HostTypes::PostRequest {
            endpoint: "/push_transaction".to_string(),
            body: HostTypes::BodyTypes::Bytes(self.packed()),
        })?)
    }
}
