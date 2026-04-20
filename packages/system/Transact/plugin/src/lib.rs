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
use host::common::{self as Host, server as Server};
use host::db::store as Store;
use host::types::types::{self as HostTypes, BodyTypes};
use virtual_server::plugin::transact as VirtualServer;

// Exported interfaces/types
use exports::transact::plugin::{
    admin::Guest as Admin, auth::Guest as Auth, hooks::Guest as Hooks, intf::Guest as Intf,
    network::Guest as Network,
};

use psibase::services::transact::action_structs::setSnapTime;

// Third-party crates
use crate::trust::*;
use psibase::fracpack::Pack;
use psibase::{Hex, SignedTransaction, Tapos, TimePointSec, Transaction, TransactionTrace};
use serde::Deserialize;
use serde_json::from_str;

psibase::define_trust! {
    descriptions {
        Low => "",
        Medium => "",
        High => "
            - alter which of your accounts is being used
        
        Warning: This will grant the caller the ability to control which of your accounts takes requested actions, including the capability to make unintended use of any of your accounts! Make sure you completely trust the caller's legitimacy.
        ",
    }
    functions {
        None => [hook_action_auth, unhook_actions_sender, add_action_to_transaction],
        Low => [],
        High => [hook_actions_sender],
        Max => [set_propose_latch, propose, set_snapshot_time, start_tx, finish_tx, get_query_token],
    }
}

// The transaction construction cycle, including hooks, is as follows:
//
// 1. start-tx
//
// 2. add-action-to-transaction
// 3.   on-actions-sender           - the propose-latch account (if any) is used;
//                                    otherwise the hooked plugin can set the sender of the action;
//                                    otherwise the logged-in user is used by default.
// 4.   on-action-auth-claims       - the hooked plugin can add claims for this action
//
// 5. finish-tx
// 6.   on-user-claim               - the user auth plugin adds the user claim
// 7.   construct transaction
// 8.   hash-transaction
// 9.   on-user-auth-proof          - the user auth plugin adds the user proof
// 10.  on-action-auth-proofs       - the hooked plugin can add proofs for their action claims
// 11.  publish transaction

struct TransactPlugin {}

impl Hooks for TransactPlugin {
    fn hook_action_auth() {
        ActionAuthPlugins::set(Host::client::get_sender());
    }

    fn hook_actions_sender() {
        assert_authorized_with_whitelist(FunctionName::hook_actions_sender, vec!["invite".into()])
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

    if ProposeLatch::is_active() {
        ProposeLatch::add(action);
    } else {
        TxActions::add(action);
    }

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

fn flush_propose_latch() -> Result<(), HostTypes::Error> {
    let Some(latch) = ProposeLatch::take() else {
        return Ok(());
    };

    if latch.actions.is_empty() {
        return Ok(());
    }

    let Some(proposer) = accounts::plugin::api::get_current_user() else {
        return Err(NotLoggedIn("flush_propose_latch").into());
    };

    let inner: Vec<psibase::Action> = latch.actions.into_iter().map(Into::into).collect();

    let wrapper = Action {
        sender: proposer,
        service: psibase::services::staged_tx::SERVICE.to_string(),
        method: psibase::services::staged_tx::action_structs::propose::ACTION_NAME.to_string(),
        raw_data: psibase::services::staged_tx::action_structs::propose {
            actions: inner,
            auto_exec: true,
        }
        .packed(),
    };
    TxActions::add(wrapper);
    Ok(())
}

impl Admin for TransactPlugin {
    fn start_tx() {
        assert_authorized_with_whitelist(FunctionName::start_tx, vec!["supervisor".into()])
            .unwrap();

        Store::clear_buffers();
        if !TxActions::is_empty() {
            println!("[Warning] Tx actions should already have been cleared.");
            TxActions::reset();
        }
        if ProposeLatch::is_active() {
            println!("[Warning] Propose latch should already have been cleared.");
            ProposeLatch::clear();
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
    }

    fn set_propose_latch(account: Option<String>) -> Result<(), HostTypes::Error> {
        assert_authorized_with_whitelist(
            FunctionName::set_propose_latch,
            vec![Host::client::get_active_app()],
        )?;

        let Some(acct) = account else {
            return flush_propose_latch();
        };

        if accounts::plugin::api::get_account(&acct)?.is_none() {
            return Err(InvalidAccount(&acct).into());
        }

        if let Some(existing) = ProposeLatch::subsequent_action_sender() {
            if existing == acct {
                return Ok(());
            }
            flush_propose_latch()?;
        }
        ProposeLatch::open(acct);
        Ok(())
    }

    fn propose(actions: Vec<Action>, auto_exec: bool) -> Result<(), HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::propose, vec!["packages".into()])?;

        let actions: Vec<psibase::Action> = actions.into_iter().map(Into::into).collect();
        let packed =
            psibase::services::staged_tx::action_structs::propose { actions, auto_exec }.packed();

        schedule_action(
            psibase::services::staged_tx::SERVICE.to_string(),
            psibase::services::staged_tx::action_structs::propose::ACTION_NAME.to_string(),
            packed,
        )
    }

    fn finish_tx() -> Result<(), HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::finish_tx, vec!["supervisor".into()])?;

        flush_propose_latch()?;

        ActionSenderHook::clear();

        let mut actions = TxActions::take();

        if actions.len() == 0 {
            Store::flush_transactional_data();
            return Ok(());
        }

        // This will automatically add the actions into the tx to
        // refill the user's gas tank if it is below some threshold
        // and the user is configured for auto-filling.
        VirtualServer::auto_fill_gas_tank(&actions[0].sender)?;
        actions.extend(TxActions::take());

        let tx = make_transaction(actions, 3);

        let signed_tx = SignedTransaction {
            transaction: Hex::from(tx.packed()),
            proofs: get_proofs(&sha256(&tx.packed()), true)?,
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
