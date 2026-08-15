#![allow(non_snake_case)]
#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;
use errors::ErrorType::*;
mod helpers;
use helpers::*;
mod types;

use host::http::api as Server;
use host::db::store as Store;
use host::types::types::{self as HostTypes, BodyTypes};
use transact::actions::ledger as ActionsLedger;
use virtual_server::plugin::preflight as VirtualServer;

use exports::transact::plugin::{
    admin::Guest as Admin, auth::Guest as Auth, network::Guest as Network,
};

use psibase::services::transact::action_structs::setSnapTime;

use crate::trust::*;
use psibase::fracpack::Pack;
use psibase::{Hex, SignedTransaction, Tapos, TimePointSec, Transaction, TransactionTrace};
use serde::Deserialize;
use serde_json::from_str;
use transact::actions::types::Action;

psibase::define_trust! {
    descriptions {
        Low => "",
        Medium => "",
        High => "",
    }
    functions {
        None => [],
        Low => [],
        High => [],
        Max => [propose, set_snapshot_time, start_tx, finish_tx, get_query_token],
    }
}

struct TransactPlugin {}

impl Network for TransactPlugin {
    fn set_snapshot_time(seconds: u32) -> Result<(), HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::set_snapshot_time, vec!["config".into()])?;

        let packed_args = setSnapTime { seconds }.packed();

        ActionsLedger::schedule(
            &psibase::services::transact::SERVICE.to_string(),
            &setSnapTime::ACTION_NAME.to_string(),
            &packed_args,
        )
    }
}

fn pack_staged_propose(actions: Vec<Action>, auto_exec: bool) -> (String, String, Vec<u8>) {
    let inner: Vec<psibase::Action> = actions.into_iter().map(Into::into).collect();
    (
        psibase::services::staged_tx::SERVICE.to_string(),
        psibase::services::staged_tx::action_structs::propose::ACTION_NAME.to_string(),
        psibase::services::staged_tx::action_structs::propose {
            actions: inner,
            auto_exec,
        }
        .packed(),
    )
}

impl Admin for TransactPlugin {
    fn start_tx() {
        assert_authorized_with_whitelist(FunctionName::start_tx, vec!["supervisor".into()])
            .unwrap();

        Store::clear_buffers();
        ActionsLedger::clear();
    }

    fn propose(actions: Vec<Action>, auto_exec: bool) -> Result<(), HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::propose, vec!["packages".into()])?;

        let (service, method, packed) = pack_staged_propose(actions, auto_exec);
        ActionsLedger::schedule(&service, &method, &packed)
    }

    fn finish_tx() -> Result<(), HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::finish_tx, vec!["supervisor".into()])?;

        let mut actions = ActionsLedger::take_actions()?;

        if actions.is_empty() {
            Store::flush_transactional_data();
            return Ok(());
        }

        // Automatically add actions into the tx to refill the user's gas tank if
        // it is below some threshold and the user is configured for auto-filling.
        VirtualServer::auto_fill_gas_tank(&actions[0].sender)?;
        actions.extend(ActionsLedger::take_actions()?);

        let (tx, extra_claims) = make_transaction(actions, 3);

        let signed_tx = SignedTransaction {
            transaction: Hex::from(tx.packed()),
            proofs: get_proofs(&sha256(&tx.packed()), &extra_claims)?,
            subjectiveData: None,
        };
        if signed_tx.proofs.len() != tx.claims.len() {
            return Err(ClaimProofMismatch.into());
        }

        let body = signed_tx.publish()?;
        let trace = match body {
            BodyTypes::Json(t) => from_str::<TransactionTrace>(&t).unwrap(),
            _ => {
                return Err(TransactionError("Invalid response body".to_string()).into());
            }
        };

        match trace.error {
            Some(err) => Err(TransactionError(err).into()),
            None => {
                println!("Transaction executed successfully");
                Store::flush_transactional_data();
                Ok(())
            }
        }
    }
}

#[derive(Deserialize)]
struct LoginReply {
    access_token: String,
    #[allow(dead_code)]
    token_type: String,
}

impl Auth for TransactPlugin {
    fn get_query_token(app: String, user: String) -> Result<String, HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::get_query_token, vec!["host".into()])?;

        let root_host: String = serde_json::from_str(&Server::get_json("/common/rootdomain")?)
            .expect("Failed to deserialize rootdomain");
        let actions = vec![Action {
            sender: user.clone(),
            service: app,
            method: "loginSys".to_string(),
            raw_data: (root_host,).packed(),
        }];

        let claims =
            get_claims_for_user(&user).expect("Failed to retrieve claims from auth plugin");

        let claims: Vec<psibase::Claim> = claims.into_iter().map(Into::into).collect();
        let actions: Vec<psibase::Action> = actions.into_iter().map(Into::into).collect();

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
        let signed_tx = SignedTransaction {
            transaction: Hex::from(tx.packed()),
            proofs: get_proofs_for_user(&sha256(&tx.packed()), &user)?,
            subjectiveData: None,
        };
        if signed_tx.proofs.len() != tx.claims.len() {
            return Err(ClaimProofMismatch.into());
        }

        let response = Server::post(&HostTypes::PostRequest {
            endpoint: "/login".to_string(),
            body: HostTypes::BodyTypes::Bytes(signed_tx.packed()),
        })?;

        let reply = match response {
            BodyTypes::Json(t) => {
                serde_json::from_str::<LoginReply>(&t).expect("Failed to deserialize response")
            }
            _ => {
                return Err(BadResponse("Invalid body type").into());
            }
        };
        Ok(reply.access_token)
    }
}

bindings::export!(TransactPlugin with_types_in bindings);
