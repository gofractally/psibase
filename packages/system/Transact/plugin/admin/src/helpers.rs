use crate::bindings::host::crypto::keyvault as HostCrypto;
use crate::bindings::host::http::api as Server;
use crate::bindings::host::accounts::api::get_current_user;
use crate::bindings::host::types::types::{self as HostTypes, BodyTypes};
use crate::errors::ErrorType::*;
use crate::open_tx_table::OpenTx;
use crate::types::FromExpirationTime;
use psibase::fracpack::Pack;
use psibase::{Hex, SignedTransaction, Tapos, Transaction};
use serde::Serialize;

fn sign_with_claim(claim: &psibase::Claim, tx_hash: &[u8]) -> Result<Vec<u8>, HostTypes::Error> {
    HostCrypto::sign(tx_hash, &claim.rawData)
}

pub fn get_proofs(
    tx_hash: &[u8; 32],
    claims: &[psibase::Claim],
) -> Result<Vec<Hex<Vec<u8>>>, HostTypes::Error> {
    claims
        .iter()
        .map(|claim| sign_with_claim(claim, tx_hash).map(Hex::from))
        .collect()
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

pub fn take_open_actions() -> Result<Vec<psibase::Action>, HostTypes::Error> {
    if OpenTx::flush_latch(get_current_user().as_deref()).is_err() {
        return Err(NotLoggedIn("flush_propose_latch").into());
    }
    OpenTx::clear_sender_hook();
    Ok(OpenTx::take_actions())
}

pub fn make_transaction(actions: Vec<psibase::Action>, expiration_seconds: u64) -> Transaction {
    let tapos = Tapos::from_expiration_time(expiration_seconds);

    let t = Transaction {
        tapos,
        actions,
        claims: OpenTx::take_claims(),
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
