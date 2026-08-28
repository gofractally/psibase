use crate::bindings::accounts::query::api::{get_account, get_current_user};
use crate::bindings::host::crypto::keyvault as HostCrypto;
use crate::bindings::host::http::api as Server;
use crate::bindings::host::types::types::{self as HostTypes, BodyTypes, PluginRef};
use crate::bindings::transact::admin::hook_handlers::*;
use crate::bindings::transact::plugin::ledger as ActionsLedger;
use crate::bindings::transact::plugin::types::{Action, Claim, Proof};
use crate::types::FromExpirationTime;
use psibase::fracpack::Pack;
use psibase::{Hex, SignedTransaction, Tapos, Transaction};
use serde::Serialize;
use sha2::{Digest, Sha256};

pub fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

fn sign_with_claim(claim: &Claim, tx_hash: &[u8]) -> Result<Vec<u8>, HostTypes::Error> {
    HostCrypto::sign(tx_hash, &claim.raw_data)
}

impl From<Action> for psibase::Action {
    fn from(action: Action) -> Self {
        psibase::Action {
            sender: action.sender.parse().unwrap(),
            service: action.service.parse().unwrap(),
            method: psibase::MethodNumber::from(action.method.as_str()),
            rawData: action.raw_data.into(),
        }
    }
}

impl From<Claim> for psibase::Claim {
    fn from(claim: Claim) -> Self {
        psibase::Claim {
            service: claim.verify_service.parse().unwrap(),
            rawData: Hex::from(claim.raw_data.clone()),
        }
    }
}

fn user_auth_claim(user: &str) -> Result<Option<Claim>, HostTypes::Error> {
    let auth_service_acc = get_account(&user.to_string())?.unwrap().auth_service;
    let plugin_ref = PluginRef::new(&auth_service_acc, "plugin", "transact-hook-user-auth");
    on_user_auth_claim(plugin_ref, user)
}

fn user_auth_proof(user: &str, tx_hash: &[u8; 32]) -> Result<Option<Proof>, HostTypes::Error> {
    let auth_service_acc = get_account(&user.to_string())?.unwrap().auth_service;
    let plugin_ref = PluginRef::new(&auth_service_acc, "plugin", "transact-hook-user-auth");
    on_user_auth_proof(plugin_ref, user, tx_hash)
}

pub fn get_proofs(
    tx_hash: &[u8; 32],
    extra_claims: &[Claim],
) -> Result<Vec<Hex<Vec<u8>>>, HostTypes::Error> {
    let mut proofs = vec![];

    if let Some(user) = get_current_user() {
        if let Some(proof) = user_auth_proof(&user, tx_hash)? {
            proofs.push(Hex::from(proof.signature));
        }
    }

    for claim in extra_claims {
        proofs.push(Hex::from(sign_with_claim(claim, tx_hash)?));
    }

    Ok(proofs)
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

pub fn make_transaction(
    actions: Vec<Action>,
    expiration_seconds: u64,
) -> (Transaction, Vec<Claim>) {
    let extra_claims = ActionsLedger::take_signatures();
    let mut claims = Vec::new();

    if let Some(user) = get_current_user() {
        if let Some(claim) = user_auth_claim(&user).expect("Failed to retrieve user auth claim") {
            claims.push(claim);
        }
    }

    claims.extend(extra_claims.iter().cloned());

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

    (t, extra_claims)
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
