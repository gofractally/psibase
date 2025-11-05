#![allow(non_snake_case)]
#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;
use errors::ErrorType::*;
mod helpers;
use helpers::*;
mod db;
mod types;
use db::*;

use transact::plugin::hook_handlers::*;

// Other plugins
// Other plugins
use host::common::{
    self as Host, server as Server,
    store::{self as Store},
};
use host::types::types::{self as HostTypes, BodyTypes};

// Exported interfaces/types
use exports::transact::plugin::{
    admin::Guest as Admin, auth::Guest as Auth, hooks::Guest as Hooks, intf::Guest as Intf,
    network::Guest as Network,
};

use psibase::services::transact::action_structs::setSnapTime;

// Third-party crates
use psibase::fracpack::Pack;
use psibase::{Hex, SignedTransaction, Tapos, TimePointSec, Transaction, TransactionTrace};
use serde::Deserialize;
use serde_json::from_str;
use crate::trust::*;

psibase::define_trust! {
    descriptions {
        Low => "",
        Medium => "",
        High => "
        High trust grants these abilities:
            - Hook actions sender
        ",
    }
    functions {
        None => [hook_action_auth, unhook_actions_sender, add_action_to_transaction],
        Low => [],
        High => [hook_actions_sender],
        Max => [hook_tx_transform_label, set_snapshot_time, start_tx, finish_tx, get_query_token],
    }
}

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
        ActionAuthPlugins::set(Host::client::get_sender());
    }

    fn hook_actions_sender() {
        assert_authorized_with_whitelist(
            FunctionName::hook_actions_sender,
            vec!["staged-tx".into(), "invite".into()],
        )
        .unwrap();

        let sender_app = Host::client::get_sender();

        if let Some(hooked) = ActionSenderHook::get() {
            if hooked != sender_app {
                panic!("Action sender hook already set");
            }
        }

        ActionSenderHook::set(sender_app);
    }

    fn unhook_actions_sender() {
        if let Some(sender) = ActionSenderHook::get() {
            if sender == Host::client::get_sender() {
                ActionSenderHook::clear();
            }
        }
    }

    fn hook_tx_transform_label(label: Option<String>) {
        assert_authorized_with_whitelist(
            FunctionName::hook_tx_transform_label,
            vec!["staged-tx".into()],
        )
        .unwrap();

        let transformer = Host::client::get_sender();

        if let Some(existing) = TxTransformLabel::get_transformer_plugin() {
            if existing != transformer {
                panic!("Error: Only one plugin can transform the transaction");
            }
        }

        TxTransformLabel::set(transformer, label);
    }
}

fn schedule_action(
    service: String,
    method_name: String,
    packed_args: Vec<u8>,
) -> Result<(), HostTypes::Error> {
    validate_action_name(&method_name)?;
    let sender = get_action_sender(service.as_str(), method_name.as_str())?;

    let action = Action {
        sender,
        service,
        method: method_name,
        raw_data: packed_args,
    };

    if let Some(plugin) = ActionAuthPlugins::get() {
        ActionAuthPlugins::clear();
        let plugin_ref = HostTypes::PluginRef::new(&plugin, "plugin", "transact-hook-action-auth");
        let claims = on_action_auth_claims(plugin_ref, &action)?;
        ActionClaims::push(plugin, claims);
    }

    CurrentActions::push(action, TxTransformLabel::get_current_label());

    Ok(())
}

impl Intf for TransactPlugin {
    fn add_action_to_transaction(
        method_name: String,
        packed_args: Vec<u8>,
    ) -> Result<(), HostTypes::Error> {
        schedule_action(Host::client::get_sender(), method_name, packed_args)
    }
}

impl Network for TransactPlugin {
    fn set_snapshot_time(seconds: u32) -> Result<(), HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::set_snapshot_time, vec!["config".into()])?;

        let packed_args = setSnapTime { seconds }.packed();

        schedule_action(
            psibase::services::transact::SERVICE.to_string(),
            setSnapTime::ACTION_NAME.to_string(),
            packed_args,
        )
    }
}

impl Admin for TransactPlugin {
    fn start_tx() {
        assert_authorized_with_whitelist(FunctionName::start_tx, vec!["supervisor".into()])
            .unwrap();

        Store::clear_buffers();
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

    fn finish_tx() -> Result<(), HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::finish_tx, vec!["supervisor".into()])?;

        ActionSenderHook::clear();

        let actions = CurrentActions::get();

        if actions.len() == 0 {
            Store::flush_transactional_data();
            return Ok(());
        }

        let actions = transform_actions(actions)?;

        let tx = make_transaction(actions, 3);

        let signed_tx = SignedTransaction {
            transaction: Hex::from(tx.packed()),
            proofs: get_proofs(&sha256(&tx.packed()), true)?,
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
