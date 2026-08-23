#![allow(non_snake_case)]
#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;
use errors::ErrorType::*;
mod db;
use db::*;

use transact::actions::hook_handlers::*;
use transact::actions::types::{Action as ImportAction, Claim as ImportClaim};

use host::client::api as Client;
use host::types::types::{self as HostTypes, PluginRef};

use exports::transact::actions::types::{
    Action as ExportAction, ActionClaims as ExportActionClaims, Claim as ExportClaim,
};
use exports::transact::actions::{
    hooks::Guest as Hooks, intf::Guest as Intf, ledger::Guest as Ledger,
};

use crate::trust::*;
use psibase::fracpack::Pack;

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
        Max => [set_propose_latch],
    }
}

struct TransactActions {}

fn assert_transact_driver(context: &str) {
    let sender = Client::get_sender();
    assert!(
        sender == "transact",
        "{} can only be called by transact, got {}",
        context,
        sender
    );
}

fn validate_action_name(action_name: &str) -> Result<(), HostTypes::Error> {
    let re = regex::Regex::new(r"^([a-zA-Z0-9_]+|#[a-z]{16})$").unwrap();
    if re.is_match(action_name) {
        return Ok(());
    }
    Err(InvalidActionName(action_name).into())
}

fn get_action_sender(service: &str, method: &str) -> Result<String, HostTypes::Error> {
    if let Some(sender) = ProposeLatch::subsequent_action_sender() {
        return Ok(sender);
    }
    if let Some(plugin) = ActionSenderHook::get() {
        if let Some(s) = on_actions_sender(
            PluginRef::new(plugin.as_str(), "plugin", "transact-hook-actions-sender"),
            service,
            method,
        )? {
            return Ok(s);
        }
    }
    if let Some(sender) = accounts::client_query::api::get_current_user() {
        return Ok(sender);
    }

    Err(NotLoggedIn("get_action_sender").into())
}

fn to_export_action(a: ImportAction) -> ExportAction {
    ExportAction {
        sender: a.sender,
        service: a.service,
        method: a.method,
        raw_data: a.raw_data,
    }
}

fn to_export_claim(c: ImportClaim) -> ExportClaim {
    ExportClaim {
        verify_service: c.verify_service,
        raw_data: c.raw_data,
    }
}

fn schedule_action(
    service: String,
    method_name: String,
    packed_args: Vec<u8>,
) -> Result<(), HostTypes::Error> {
    validate_action_name(&method_name)?;
    let sender = get_action_sender(service.as_str(), method_name.as_str())?;

    let action = ImportAction {
        sender,
        service,
        method: method_name,
        raw_data: packed_args,
    };

    if let Some(plugin) = ActionAuthPlugins::get() {
        ActionAuthPlugins::clear();
        let plugin_ref = PluginRef::new(&plugin, "plugin", "transact-hook-action-auth");
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

fn pack_staged_propose(actions: Vec<ImportAction>, auto_exec: bool) -> (String, String, Vec<u8>) {
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

    let Some(proposer) = accounts::client_query::api::get_current_user() else {
        return Err(NotLoggedIn("flush_propose_latch").into());
    };

    let (service, method, raw_data) = pack_staged_propose(latch.actions, true);
    TxActions::add(ImportAction {
        sender: proposer,
        service,
        method,
        raw_data,
    });
    Ok(())
}

impl From<ImportAction> for psibase::Action {
    fn from(action: ImportAction) -> Self {
        psibase::Action {
            sender: action.sender.parse().unwrap(),
            service: action.service.parse().unwrap(),
            method: psibase::MethodNumber::from(action.method.as_str()),
            rawData: action.raw_data.into(),
        }
    }
}

impl Hooks for TransactActions {
    fn hook_action_auth() {
        ActionAuthPlugins::set(Client::get_sender());
    }

    fn hook_actions_sender() {
        assert_authorized_with_whitelist(FunctionName::hook_actions_sender, vec!["invite".into()])
            .unwrap();

        let sender_app = Client::get_sender();

        if let Some(hooked) = ActionSenderHook::get() {
            if hooked != sender_app {
                panic!("Action sender hook already set");
            }
        }

        ActionSenderHook::set(sender_app);
    }

    fn unhook_actions_sender() {
        if let Some(sender) = ActionSenderHook::get() {
            if sender == Client::get_sender() {
                ActionSenderHook::clear();
            }
        }
    }
}

impl Intf for TransactActions {
    fn add_action_to_transaction(
        method_name: String,
        packed_args: Vec<u8>,
    ) -> Result<(), HostTypes::Error> {
        schedule_action(Client::get_sender(), method_name, packed_args)
    }

    fn set_propose_latch(account: Option<String>) -> Result<(), HostTypes::Error> {
        assert_authorized_with_whitelist(
            FunctionName::set_propose_latch,
            vec![Client::get_active_app(), String::from("accounts")],
        )?;

        let Some(acct) = account else {
            return flush_propose_latch();
        };

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

impl Ledger for TransactActions {
    fn clear() {
        assert_transact_driver("ledger.clear");

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
        if !ActionClaims::get_all().is_empty() {
            println!("[Warning] Action claims should already have been cleared.");
            ActionClaims::clear();
        }
    }

    fn schedule(
        service: String,
        method_name: String,
        packed_args: Vec<u8>,
    ) -> Result<(), HostTypes::Error> {
        assert_transact_driver("ledger.schedule");
        schedule_action(service, method_name, packed_args)
    }

    fn take_actions() -> Result<Vec<ExportAction>, HostTypes::Error> {
        assert_transact_driver("ledger.take-actions");
        flush_propose_latch()?;
        ActionSenderHook::clear();
        Ok(TxActions::take().into_iter().map(to_export_action).collect())
    }

    fn take_action_claims() -> Vec<ExportActionClaims> {
        assert_transact_driver("ledger.take-action-claims");
        ActionClaims::take_all()
            .into_iter()
            .map(|c| ExportActionClaims {
                claimant: c.claimant,
                claims: c.claims.into_iter().map(to_export_claim).collect(),
            })
            .collect()
    }
}

bindings::export!(TransactActions with_types_in bindings);
