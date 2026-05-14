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

use host::common::{self as Host, server as Server};
use host::db::store as Store;
use host::types::types::{self as HostTypes, BodyTypes, Claim};
use transact::plugin::types::Action;
use virtual_server::plugin::transact as VirtualServer;

use exports::transact::plugin::{
    admin::Guest as Admin, auth::Guest as Auth, hooks::Guest as Hooks, intf::Guest as Intf,
    network::Guest as Network,
};

use psibase::services::transact::action_structs::setSnapTime;

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
        None => [add_signature, unhook_actions_sender, add_action_to_transaction],
        Low => [],
        High => [hook_actions_sender],
        Max => [set_propose_latch, propose, set_snapshot_time, start_tx, finish_tx, get_query_token],
    }
}

struct TransactPlugin {}

impl Hooks for TransactPlugin {
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

    fn add_signature(claim: Claim) -> Result<(), HostTypes::Error> {
        TxSignatures::add(claim);
        Ok(())
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

    let (service, method, raw_data) = pack_staged_propose(latch.actions, true);
    TxActions::add(Action {
        sender: proposer,
        service,
        method,
        raw_data,
    });
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
        if ActionSenderHook::has() {
            println!("[Warning] Action sender hook should already have been cleared.");
            ActionSenderHook::clear();
        }
        if !TxSignatures::is_empty() {
            println!("[Warning] Tx signatures should already have been cleared.");
            TxSignatures::reset();
        }
    }

    fn propose(actions: Vec<Action>, auto_exec: bool) -> Result<(), HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::propose, vec!["packages".into()])?;

        let (service, method, packed) = pack_staged_propose(actions, auto_exec);
        schedule_action(service, method, packed)
    }

    fn finish_tx() -> Result<(), HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::finish_tx, vec!["supervisor".into()])?;

        flush_propose_latch()?;

        ActionSenderHook::clear();

        let mut actions = TxActions::take();

        if actions.len() == 0 {
            TxSignatures::reset();
            Store::flush_transactional_data();
            return Ok(());
        }

        // This will automatically add the actions into the tx to
        // refill the user's gas tank if it is below some threshold
        // and the user is configured for auto-filling.
        VirtualServer::auto_fill_gas_tank(&actions[0].sender)?;
        actions.extend(TxActions::take());

        let tx = make_transaction(actions, 3);

        let tx_hash = sha256(&tx.packed());
        let proofs = build_proofs(&tx_hash)?;
        TxSignatures::reset();

        let signed_tx = SignedTransaction {
            transaction: Hex::from(tx.packed()),
            proofs,
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
    fn get_query_token(
        app: String,
        user: String,
        claim: Option<Claim>,
    ) -> Result<String, HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::get_query_token, vec!["host".into()])?;

        let root_host: String = serde_json::from_str(&Server::get_json("/common/rootdomain")?)
            .expect("Failed to deserialize rootdomain");
        let action = Action {
            sender: user.clone(),
            service: app,
            method: "loginSys".to_string(),
            raw_data: (root_host,).packed(),
        };

        let tx_claim = claim.as_ref().map(|c| psibase::Claim::from(c.clone()));

        let expiration = TimePointSec::from(chrono::Utc::now() + chrono::Duration::seconds(3));
        let tapos = Tapos {
            expiration,
            refBlockSuffix: 0,
            flags: Tapos::DO_NOT_BROADCAST_FLAG,
            refBlockIndex: 0,
        };

        let tx = Transaction {
            tapos,
            actions: vec![action.into()],
            claims: match tx_claim {
                Some(claim) => vec![claim],
                None => vec![],
            },
        };
        let tx_hash = sha256(&tx.packed());

        let proofs: Vec<Hex<Vec<u8>>> = match claim.as_ref() {
            Some(c) => vec![Hex::from(sign_with_claim(c, &tx_hash)?)],
            None => Vec::new(),
        };

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
