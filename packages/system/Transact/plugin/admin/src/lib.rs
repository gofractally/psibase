#![allow(non_snake_case)]
#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;
use errors::ErrorType::*;
mod helpers;
use helpers::*;
mod types;

use host::db::store as Store;
use host::types::types::{self as HostTypes, BodyTypes};
use transact::plugin::ledger as ActionsLedger;
use virtual_server::plugin::transact as VirtualServer;

use exports::transact::admin::admin::Guest as Admin;

use crate::trust::*;
use psibase::fracpack::Pack;
use psibase::{Hex, SignedTransaction, TransactionTrace};
use serde_json::from_str;
use sha2::{Digest, Sha256};

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
        Max => [start_tx, finish_tx],
    }
}

struct TransactAdmin {}

impl Admin for TransactAdmin {
    fn start_tx() {
        assert_authorized_with_whitelist(FunctionName::start_tx, vec!["supervisor".into()])
            .unwrap();

        Store::clear_buffers();
        ActionsLedger::clear();
    }

    fn finish_tx() -> Result<(), HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::finish_tx, vec!["supervisor".into()])?;

        let mut actions = ActionsLedger::take_actions()?;

        if actions.is_empty() {
            Store::flush_transactional_data();
            return Ok(());
        }

        // This will automatically add the actions into the tx to
        // refill the user's gas tank if it is below some threshold
        // and the user is configured for auto-filling.
        VirtualServer::auto_fill_gas_tank(&actions[0].sender)?;
        actions.extend(ActionsLedger::take_actions()?);

        let (tx, extra_claims) = make_transaction(actions, 3);

        let signed_tx = SignedTransaction {
            transaction: Hex::from(tx.packed()),
            proofs: get_proofs(&Sha256::digest(&tx.packed()).into(), &extra_claims)?,
            subjectiveData: None,
        };
        if signed_tx.proofs.len() != tx.claims.len() {
            return Err(ClaimProofMismatch.into());
        }

        // TODO (idea): on_hook_pre_publish(signed_tx) -> bool
        // Could allow a user to inspect a final transaction rather than publish
        //   (Helpful for debugging, post-install scripts, offline msig, etc.)

        let body = signed_tx.publish()?;
        let trace = match body {
            BodyTypes::Json(t) => from_str::<TransactionTrace>(&t).unwrap(),
            _ => {
                return Err(TransactionError("Invalid response body".to_string()).into());
            }
        };

        // TODO (idea): on_hook_post_publish(trace)
        // Could be for logging, or for other post-transaction client-side processing

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

bindings::export!(TransactAdmin with_types_in bindings);
