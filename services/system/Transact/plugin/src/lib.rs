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

use crate::bindings::transact::plugin::hook_handlers::*;

// Other plugins
// Other plugins
use bindings::host::common::{
    self as Host,
    types::{self as CommonTypes},
};

// Exported interfaces/types
use bindings::exports::transact::plugin::{
    admin::Guest as Admin, hooks::Guest as Hooks, intf::Guest as Intf,
};

// Third-party crates
use psibase::fracpack::Pack;
use psibase::{Hex, SignedTransaction, TransactionTrace};
use serde_json::from_str;

// The transaction construction cycle, including hooks, is as follows:
//
// 1. start-tx
//
// 2. add-action-to-transaction
// 3.   on-actions-sender           - the hooked plugin can set the sender of the action, otherwise the logged-in user is used by default
// 4.   on-action-auth-claims      - the hooked plugin can add claims for this action
// 5.   save action details
//
// 6. finish-tx
// 7.   on-user-claim              - the user auth plugin adds the user claim
// 8.   on-tx-transform            - the hooked plugin can transform the set of actions in the transaction
// 9.   construct transaction
// 10.  hash-transaction
// 11.  on-user-auth-proof         - the user auth plugin adds the user proof
// 12.  on-action-auth-proofs      - the hooked plugin can add proofs for their action claims
// 13.  publish transaction

struct TransactPlugin {}

impl Hooks for TransactPlugin {
    fn hook_action_auth() {
        ActionAuthPlugins::set(get_sender_app());
    }

    fn hook_actions_sender() {
        let sender_app = get_sender_app();

        if let Some(hooked) = ActionSenderHook::get() {
            if hooked != sender_app {
                panic!("Action sender hook already set");
            }
        }

        // Temporary whitelist until we have oauth
        if sender_app != "staged-tx" && sender_app != "invite" {
            panic!("hook_actions_sender: {} is not whitelisted", sender_app);
        }

        ActionSenderHook::set(get_sender_app());
    }

    fn unhook_actions_sender() {
        if let Some(sender) = ActionSenderHook::get() {
            if sender == get_sender_app() {
                ActionSenderHook::clear();
            }
        }
    }

    fn hook_tx_transform_label(label: Option<String>) {
        let transformer = get_sender_app();

        if let Some(existing) = TxTransformLabel::get_transformer_plugin() {
            if existing != transformer {
                panic!("Error: Only one plugin can transform the transaction");
            }
        }

        // TODO: Use `permissions` oauth instead of hardcoded whitelist
        if transformer != "staged-tx" {
            panic!(
                "hook_tx_transform_label: {} is not whitelisted",
                transformer
            );
        }

        TxTransformLabel::set(transformer, label);
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
            .ok_or_else(|| OnlyAvailableToPlugins("add_action_to_transaction"))?;

        let sender = get_action_sender(service.as_str(), method_name.as_str())?;

        let action = Action {
            sender,
            service,
            method: method_name,
            raw_data: packed_args,
        };

        if let Some(plugin) = ActionAuthPlugins::get() {
            ActionAuthPlugins::clear();
            let plugin_ref =
                Host::types::PluginRef::new(&plugin, "plugin", "transact-hook-action-auth");
            let claims = on_action_auth_claims(plugin_ref, &action)?;
            ActionClaims::push(plugin, claims);
        }

        CurrentActions::push(action, TxTransformLabel::get_current_label());

        Ok(())
    }
}

impl Admin for TransactPlugin {
    fn start_tx() {
        assert_from_supervisor();
        if CurrentActions::has_actions() {
            println!("[Warning] Transaction should already have been cleared.");
            CurrentActions::clear();
        }
        if ActionAuthPlugins::has() {
            println!("[Warning] Auth plugins should already have been cleared.");
            ActionAuthPlugins::clear();
        }
        if ActionSenderHook::has() {
            println!("[Warning] Action sender hook should already have been cleared.");
            ActionSenderHook::clear();
        }
        if ActionClaims::get_all().len() > 0 {
            println!("[Warning] Action claims should already have been cleared.");
            ActionClaims::clear();
        }
        if TxTransformLabel::has() {
            println!("[Warning] Tx transform label should already have been cleared.");
            TxTransformLabel::clear();
        }
    }

    fn finish_tx() -> Result<(), CommonTypes::Error> {
        assert_from_supervisor();
        ActionSenderHook::clear();

        let actions = CurrentActions::get();
        if actions.len() == 0 {
            return Ok(());
        }

        let actions = transform_actions(actions)?;

        let tx = make_transaction(actions, 10);

        let signed_tx = SignedTransaction {
            transaction: Hex::from(tx.packed()),
            proofs: get_proofs(&sha256(&tx.packed()))?,
        };
        if signed_tx.proofs.len() != tx.claims.len() {
            return Err(ClaimProofMismatch.into());
        }

        // TODO (idea): on_hook_pre_publish(signed_tx) -> bool
        // Could allow a user to inspect a final transaction rather than publish
        //   (Helpful for debugging, post-install scripts, offline msig, etc.)

        let trace = from_str::<TransactionTrace>(&signed_tx.publish()?).unwrap();

        // TODO (idea): on_hook_post_publish(trace)
        // Could be for logging, or for other post-transaction client-side processing

        match trace.error {
            Some(err) => Err(TransactionError(err).into()),
            None => {
                println!("Transaction executed successfully");
                Ok(())
            }
        }
    }
}

bindings::export!(TransactPlugin with_types_in bindings);
