#![allow(non_snake_case)]
#[allow(warnings)]
mod bindings;
mod errors;
use errors::ErrorType::*;
mod helpers;
use helpers::*;
mod db;
mod types;
use db::*;

// Other plugins
use bindings::host::common::{
    self as Host,
    types::{self as CommonTypes},
};

// Exported interfaces/types
use bindings::exports::transact::plugin::{
    admin::Guest as Admin, auth::Guest as Auth, intf::Guest as Intf,
};

// Third-party crates
use psibase::fracpack::Pack;
use psibase::{Hex, SignedTransaction, TransactionTrace};
use serde_json::from_str;

struct TransactPlugin {}

impl Auth for TransactPlugin {
    fn notify() {
        let auth_plugin = Host::client::get_sender_app()
            .app
            .expect("Sender app not set");

        AuthPlugins::push(auth_plugin);
    }
}

impl Intf for TransactPlugin {
    fn add_action_to_transaction(
        method_name: String,
        packed_args: Vec<u8>,
    ) -> Result<(), CommonTypes::Error> {
        validate_action_name(&method_name)?;

        let service = Host::client::get_sender_app()
            .app
            .ok_or_else(|| OnlyAvailableToPlugins.err("add_action_to_transaction"))?;

        CurrentActions::push(service, method_name, packed_args);

        Ok(())
    }
}

impl Admin for TransactPlugin {
    fn start_tx() {
        assert_from_supervisor();
        if CurrentActions::has_actions() {
            println!("[Warning] Transaction list should already have been cleared.");
            CurrentActions::clear();
        }
        if AuthPlugins::has_plugins() {
            println!("[Warning] Auth plugins should already have been cleared.");
            AuthPlugins::clear();
        }
    }

    fn finish_tx() -> Result<(), CommonTypes::Error> {
        assert_from_supervisor();

        let actions = CurrentActions::get();
        if actions.len() == 0 {
            return Ok(());
        }
        CurrentActions::clear();

        let sender = get_tx_sender(&actions)?;
        let tx = make_transaction(&actions, sender, 10);
        let signed_tx = SignedTransaction {
            transaction: Hex::from(tx.packed()),
            proofs: get_proofs(&sender, &sha256(&tx.packed()))?,
        };
        if signed_tx.proofs.len() != tx.claims.len() {
            return Err(ClaimProofMismatch.err("Number of proofs does not match number of claims"));
        }

        let trace = from_str::<TransactionTrace>(&signed_tx.publish()?).unwrap();

        match trace.error {
            Some(err) => Err(TransactionError.err(&err)),
            None => {
                println!("Transaction executed successfully");
                Ok(())
            }
        }
    }
}

bindings::export!(TransactPlugin with_types_in bindings);
