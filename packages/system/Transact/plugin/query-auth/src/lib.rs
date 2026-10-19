#![allow(non_snake_case)]
#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;
use errors::ErrorType::*;

use crate::bindings::accounts::query::api as AccountsQuery;
use crate::bindings::host::client::api::get_sender;
use crate::bindings::host::http::api as Server;
use crate::bindings::host::types::types::{self as HostTypes, BodyTypes, Error, PluginRef};
use crate::bindings::transact::query_auth::hook_handlers::{self, Claim};

use exports::transact::query_auth::api::Guest as Api;

use psibase::fracpack::Pack;
use psibase::{Hex, SignedTransaction, Tapos, TimePointSec, Transaction};
use serde::Deserialize;
use sha2::{Digest, Sha256};

struct TransactQueryAuth;

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

fn auth_service_of(user: &str) -> Result<String, Error> {
    AccountsQuery::get_account(user)?
        .map(|a| a.auth_service)
        .ok_or_else(|| AccountNotFound(user).into())
}

fn user_auth_claim(user: &str, auth_service: &str) -> Result<Option<Claim>, Error> {
    let plugin_ref = PluginRef::new(auth_service, "plugin", "transact-hook-user-auth");
    hook_handlers::on_user_auth_claim(plugin_ref, user)
}

fn user_auth_proof(
    user: &str,
    auth_service: &str,
    tx_hash: &[u8; 32],
) -> Result<Option<Vec<u8>>, Error> {
    let plugin_ref = PluginRef::new(auth_service, "plugin", "transact-hook-user-auth");
    Ok(hook_handlers::on_user_auth_proof(plugin_ref, user, tx_hash)?.map(|proof| proof.signature))
}

#[derive(Deserialize)]
struct LoginReply {
    access_token: String,
    #[allow(dead_code)]
    token_type: String,
}

impl Api for TransactQueryAuth {
    fn get_query_token(app: String, user: String) -> Result<String, Error> {
        check_caller(&["host"], "get-query-token@transact:query-auth/api");

        let auth_service = auth_service_of(&user)?;

        let root_host: String = serde_json::from_str(&Server::get_json("/common/rootdomain")?)
            .map_err(|_| BadResponse("Failed to deserialize rootdomain"))?;

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
            expiration,
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
            user_auth_proof(&user, &auth_service, &Sha256::digest(&tx.packed()).into())?
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

        let response = Server::post(&HostTypes::PostRequest {
            endpoint: "/login".to_string(),
            body: BodyTypes::Bytes(signed_tx.packed()),
        })?;

        match response {
            BodyTypes::Json(t) => serde_json::from_str::<LoginReply>(&t)
                .map(|reply| reply.access_token)
                .map_err(|_| BadResponse("Failed to deserialize login reply").into()),
            _ => Err(BadResponse("Invalid body type").into()),
        }
    }
}

bindings::export!(TransactQueryAuth with_types_in bindings);
