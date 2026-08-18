#![allow(non_snake_case)]
#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;
use errors::ErrorType::*;

use crate::bindings::host::client::api::get_sender;
use crate::bindings::host::types::types::{Error, PluginRef};
use crate::bindings::transact::login::hook_handlers::*;
use crate::bindings::transact::login::types::Claim;

use exports::transact::login::api::Guest as Api;

use psibase::fracpack::Pack;
use psibase::{Hex, SignedTransaction, Tapos, TimePointSec, Transaction};
use sha2::{Digest, Sha256};

struct TransactLogin;

fn sha256(data: &[u8]) -> [u8; 32] {
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher.finalize().into()
}

fn check_caller(allowed: &[&str], context: &str) {
    let app = get_sender();
    if !allowed.contains(&app.as_str()) {
        panic!("[{}] Unauthorized caller: {}", context, app);
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

fn user_auth_claim(user: &str, auth_service: &str) -> Result<Option<Claim>, Error> {
    let plugin_ref = PluginRef::new(auth_service, "plugin", "transact-hook-user-auth");
    on_user_auth_claim(plugin_ref, user)
}

fn user_auth_proof(
    user: &str,
    auth_service: &str,
    tx_hash: &[u8; 32],
) -> Result<Option<Vec<u8>>, Error> {
    let plugin_ref = PluginRef::new(auth_service, "plugin", "transact-hook-user-auth");
    Ok(on_user_auth_proof(plugin_ref, user, tx_hash)?.map(|proof| proof.signature))
}

impl Api for TransactLogin {
    fn build(
        app: String,
        user: String,
        root_host: String,
        auth_service: String,
    ) -> Result<Vec<u8>, Error> {
        check_caller(&["host"], "build@transact:login/api");

        let claims: Vec<psibase::Claim> = user_auth_claim(&user, &auth_service)?
            .into_iter()
            .map(Into::into)
            .collect();

        let actions = vec![psibase::Action {
            sender: user.parse().unwrap(),
            service: app.parse().unwrap(),
            method: psibase::MethodNumber::from("loginSys"),
            rawData: (root_host,).packed().into(),
        }];

        let expiration = TimePointSec::from(chrono::Utc::now() + chrono::Duration::seconds(3));
        let tapos = Tapos {
            expiration: expiration,
            refBlockSuffix: 0,
            flags: Tapos::DO_NOT_BROADCAST_FLAG,
            refBlockIndex: 0,
        };

        let tx = Transaction {
            tapos,
            actions,
            claims,
        };
        let proofs: Vec<Hex<Vec<u8>>> =
            user_auth_proof(&user, &auth_service, &sha256(&tx.packed()))?
                .into_iter()
                .map(Hex::from)
                .collect();
        let signed_tx = SignedTransaction {
            transaction: Hex::from(tx.packed()),
            proofs,
            subjectiveData: None,
        };
        if signed_tx.proofs.len() != tx.claims.len() {
            return Err(ClaimProofMismatch.into());
        }

        Ok(signed_tx.packed())
    }
}

bindings::export!(TransactLogin with_types_in bindings);
