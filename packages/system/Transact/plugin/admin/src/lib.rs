#![allow(non_snake_case)]
#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;
use errors::ErrorType::*;
mod helpers;
use helpers::*;
#[path = "../../shared/open_tx_table.rs"]
mod open_tx_table;
use open_tx_table::OpenTx;
mod types;

use host::db::store as Store;
use host::types::types::{self as HostTypes, BodyTypes};
use virtual_server::plugin::transact as VirtualServer;

use exports::transact::admin::admin::Guest as Admin;

use crate::trust::*;

use psibase::{SignedTransaction, TransactionTrace};
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
        OpenTx::initialize_connection(host::accounts::api::get_current_user());
    }

    fn finish_tx() -> Result<(), HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::finish_tx, vec!["supervisor".into()])?;

        let mut actions = take_open_actions()?;

        if actions.is_empty() {
            Store::flush_transactional_data();
            return Ok(());
        }
        OpenTx::check_connection(host::accounts::api::get_current_user())
            .map_err(ConnectionChanged)?;

        // This will automatically add the actions into the tx to
        // refill the user's gas tank if it is below some threshold
        // and the user is configured for auto-filling.
        VirtualServer::auto_fill_gas_tank(&actions[0].sender.to_string())?;
        actions.extend(take_open_actions()?);
        OpenTx::validate_connection(host::accounts::api::get_current_user())
            .map_err(ConnectionChanged)?;

        let (tx, extra_claims, evidence) = make_transaction(actions, 3);
        let mut proofs = get_proofs(&Sha256::digest(&psio::to_pssz(&tx)).into(), &extra_claims)?;
        proofs.extend(evidence);

        let signed_tx = SignedTransaction {
            transaction: psio::pssz::Nested::new(&tx).unwrap(),
            proofs,
            subjectiveData: None,
        };
        if signed_tx.proofs.len() != tx.claims.len() {
            return Err(ClaimProofMismatch.into());
        }

        // TODO (idea): on_hook_pre_publish(signed_tx) -> bool
        // Could allow a user to inspect a final transaction rather than publish
        //   (Helpful for debugging, post-install scripts, offline msig, etc.)

        OpenTx::validate_connection(host::accounts::api::get_current_user())
            .map_err(ConnectionChanged)?;
        let scopes: Vec<transact::plugin::types::ActionScope> = tx
            .actions
            .iter()
            .map(|action| transact::plugin::types::ActionScope {
                sender: action.sender.to_string(),
                service: action.service.to_string(),
            })
            .collect();
        // Optional guards are registered by authenticated plugin principals in
        // this context only. No installed Tokens (or other app) dependency is
        // introduced for unrelated transactions. Guards run after proofs and
        // receive only the actual signed sender/service scopes.
        for service in OpenTx::begin_pre_publish() {
            transact::admin::hook_handlers::on_pre_publish(
                host::types::types::PluginRef::new(&service, "plugin", "transact-hook-pre-publish"),
                &scopes,
            )?;
            OpenTx::validate_connection(host::accounts::api::get_current_user())
                .map_err(ConnectionChanged)?;
        }
        OpenTx::validate_connection(host::accounts::api::get_current_user())
            .map_err(ConnectionChanged)?;
        let body = signed_tx.publish()?;
        let trace = match body {
            BodyTypes::Json(t) => from_str::<TransactionTrace>(&t).unwrap(),
            _ => {
                return Err(TransactionError("Invalid response body".to_string()).into());
            }
        };

        // TODO (idea): on_hook_post_publish(trace)
        // Could be for logging, or for other post-transaction client-side processing

        match trace.error_text() {
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
