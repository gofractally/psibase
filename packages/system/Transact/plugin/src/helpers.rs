use crate::bindings::accounts::plugin::api::get_current_user;
use crate::bindings::host::common as Host;
use crate::bindings::host::crypto::keyvault as HostCrypto;
use crate::bindings::host::types::types::{self as HostTypes, BodyTypes, Claim, PluginRef};
use crate::bindings::transact::plugin::types::Action;
use crate::errors::ErrorType::*;
use crate::types::FromExpirationTime;
use crate::{ActionSenderHook, ProposeLatch, TxSignatures};
use psibase::fracpack::Pack;
use psibase::{AccountNumber, Hex, MethodNumber, SignedTransaction, Tapos, Transaction};
use serde::Serialize;
use Host::server as Server;

use regex::Regex;
use sha2::{Digest, Sha256};

pub fn validate_action_name(action_name: &str) -> Result<(), HostTypes::Error> {
    let re = Regex::new(r"^[a-zA-Z0-9_]+$").unwrap();
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
        if let Some(s) = crate::bindings::transact::plugin::hook_handlers::on_actions_sender(
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
            sender: AccountNumber::from(action.sender.as_str()),
            service: AccountNumber::from(action.service.as_str()),
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

pub fn build_proofs(tx_hash: &[u8; 32]) -> Result<Vec<Hex<Vec<u8>>>, HostTypes::Error> {
    TxSignatures::with(|claims| {
        claims
            .iter()
            .map(|c| sign_with_claim(c, tx_hash).map(Hex::from))
            .collect()
    })
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
    let claims: Vec<psibase::Claim> = TxSignatures::with(|claims| {
        claims
            .iter()
            .map(|c| psibase::Claim::from(c.clone()))
            .collect()
    });

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
