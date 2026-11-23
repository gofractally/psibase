#![allow(non_snake_case)]
#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;
use errors::ErrorType::*;
#[path = "../../shared/open_tx_table.rs"]
mod open_tx_table;
use open_tx_table::OpenTx;

use transact::plugin::hook_handlers::*;
use transact::plugin::types::{Action as ImportAction, Claim as ImportClaim};

use host::client::api as Client;
use host::http::api as Server;
use host::types::types::{self as HostTypes, BodyTypes, PluginRef};

use exports::transact::plugin::types::{Action as ExportAction, Claim as ExportClaim};
use exports::transact::plugin::{
    api::Guest as Api, auth::Guest as Auth, authorized::Guest as Authorized, hooks::Guest as Hooks,
    network::Guest as Network,
};

use crate::trust::*;
use psibase::fracpack::Pack;
use psibase::services::transact::action_structs::setSnapTime;
use psibase::{Hex, SignedTransaction, Tapos, TimePointSec, Transaction};
use serde::Deserialize;
use sha2::{Digest, Sha256};

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
        None => [add_evidence, add_signature, unhook_actions_sender, add_action_to_transaction, add_action_id_to_transaction, register_pre_publish_hook],
        Low => [],
        High => [hook_actions_sender],
        Max => [set_propose_latch, propose, set_snapshot_time, get_query_token],
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
// 4. add-signature                 - callers may append extra claims (e.g. invite credentials)
//
// 5. finish-tx
// 6.   on-user-claim               - the user auth plugin adds the user claim
// 7.   construct transaction       - includes any claims from add-signature
// 8.   hash-transaction
// 9.   on-user-auth-proof          - the user auth plugin adds the user proof
// 10.  sign extra claims           - proofs for add-signature claims via host:crypto
// 11.  publish transaction

struct TransactPlugin {}

fn validate_action_name(action_name: &str) -> Result<psibase::ActionName, HostTypes::Error> {
    action_name
        .parse::<psibase::ActionName>()
        .map_err(|_| InvalidActionName(action_name).into())
}

fn validate_action_id(method_id: u64) -> Result<(psibase::ActionName, String), HostTypes::Error> {
    let method = psibase::ActionName::new(method_id);
    let diagnostic = format!("numeric ID 0x{method_id:016x}");
    let text = method
        .try_to_string()
        .map_err(|_| HostTypes::Error::from(InvalidActionName(&diagnostic)))?;
    Ok((method, text))
}

fn get_action_sender(service: &str, method: &str) -> Result<String, HostTypes::Error> {
    if OpenTx::publication_started() {
        return Err(PrePublishHook("cannot add actions during publication callbacks").into());
    }
    OpenTx::check_connection(bindings::host::accounts::api::get_current_user())
        .map_err(ConnectionChanged)?;
    if let Some(sender) = OpenTx::latch_sender() {
        return Ok(sender);
    }
    if let Some(plugin) = OpenTx::sender_hook() {
        let sender = on_actions_sender(
            PluginRef::new(plugin.as_str(), "plugin", "transact-hook-actions-sender"),
            service,
            method,
        )?;
        OpenTx::validate_connection(bindings::host::accounts::api::get_current_user())
            .map_err(ConnectionChanged)?;
        if let Some(s) = sender {
            return Ok(s);
        }
    }
    if let Some(sender) = OpenTx::connection_user() {
        return Ok(sender);
    }

    Err(NotLoggedIn("get_action_sender").into())
}

fn schedule_action(
    service: String,
    method_name: String,
    packed_args: Vec<u8>,
) -> Result<(), HostTypes::Error> {
    let method = validate_action_name(&method_name)?;
    schedule_parsed_action(service, method, &method_name, packed_args)
}

fn schedule_parsed_action(
    service: String,
    method: psibase::ActionName,
    method_name: &str,
    packed_args: Vec<u8>,
) -> Result<(), HostTypes::Error> {
    let sender = get_action_sender(service.as_str(), method_name)?;

    let action = psibase::Action {
        sender: sender
            .parse()
            .map_err(|_| BadResponse("invalid action sender"))?,
        service: service
            .parse()
            .map_err(|_| BadResponse("invalid action service"))?,
        method,
        rawData: packed_args.into(),
    };

    if OpenTx::latch_is_active() {
        OpenTx::add_latched(action);
    } else {
        OpenTx::add_action(action);
    }

    Ok(())
}

fn pack_staged_propose(
    actions: Vec<psibase::Action>,
    auto_exec: bool,
) -> (String, String, Vec<u8>) {
    (
        psibase::services::staged_tx::SERVICE.to_string(),
        psibase::services::staged_tx::action_structs::propose::ACTION_NAME.to_string(),
        psibase::services::staged_tx::action_structs::propose { actions, auto_exec }.packed(),
    )
}

fn flush_propose_latch() -> Result<(), HostTypes::Error> {
    if !OpenTx::latch_is_active() {
        return Ok(());
    }
    OpenTx::check_connection(bindings::host::accounts::api::get_current_user())
        .map_err(ConnectionChanged)?;
    OpenTx::flush_latch(OpenTx::connection_user().as_deref())
        .map_err(|_| NotLoggedIn("flush_propose_latch").into())
}

fn user_auth_claim(user: &str) -> Result<Option<ImportClaim>, HostTypes::Error> {
    let auth_service_acc = accounts::query::api::get_account(&user.to_string())?
        .unwrap()
        .auth_service;
    let plugin_ref = PluginRef::new(&auth_service_acc, "plugin", "transact-hook-user-auth");
    on_user_auth_claim(plugin_ref, user)
}

fn user_auth_proof(
    user: &str,
    tx_hash: &[u8; 32],
) -> Result<Option<transact::plugin::types::Proof>, HostTypes::Error> {
    let auth_service_acc = accounts::query::api::get_account(&user.to_string())?
        .unwrap()
        .auth_service;
    let plugin_ref = PluginRef::new(&auth_service_acc, "plugin", "transact-hook-user-auth");
    on_user_auth_proof(plugin_ref, user, tx_hash)
}

impl TryFrom<ImportAction> for psibase::Action {
    type Error = HostTypes::Error;
    fn try_from(action: ImportAction) -> Result<Self, Self::Error> {
        Ok(psibase::Action {
            sender: action
                .sender
                .parse()
                .map_err(|_| BadResponse("invalid action sender"))?,
            service: action
                .service
                .parse()
                .map_err(|_| BadResponse("invalid action service"))?,
            method: validate_action_name(&action.method)?,
            rawData: action.raw_data.into(),
        })
    }
}

impl From<ImportClaim> for psibase::Claim {
    fn from(claim: ImportClaim) -> Self {
        psibase::Claim {
            service: claim.verify_service.parse().unwrap(),
            rawData: Hex::from(claim.raw_data.clone()),
        }
    }
}

impl Hooks for TransactPlugin {
    fn register_pre_publish_hook() -> Result<(), HostTypes::Error> {
        // Host supplies the caller principal; callers cannot register a peer or
        // remove another plugin's publication guard.
        OpenTx::register_pre_publish_hook(&Client::get_sender())
            .map_err(|e| PrePublishHook(e).into())
    }
    fn hook_actions_sender() {
        assert_authorized_with_whitelist(FunctionName::hook_actions_sender, vec!["invite".into()])
            .unwrap();

        let sender_app = Client::get_sender();

        if let Some(hooked) = OpenTx::sender_hook() {
            if hooked != sender_app {
                panic!("Action sender hook already set");
            }
        }

        OpenTx::set_sender_hook(sender_app);
    }

    fn unhook_actions_sender() {
        if let Some(sender) = OpenTx::sender_hook() {
            if sender == Client::get_sender() {
                OpenTx::clear_sender_hook();
            }
        }
    }
}

impl Api for TransactPlugin {
    fn add_action_to_transaction(
        method_name: String,
        packed_args: Vec<u8>,
    ) -> Result<(), HostTypes::Error> {
        schedule_action(Client::get_sender(), method_name, packed_args)
    }

    fn add_action_id_to_transaction(
        method_id: u64,
        packed_args: Vec<u8>,
    ) -> Result<(), HostTypes::Error> {
        let (method, method_name) = validate_action_id(method_id)?;
        schedule_parsed_action(Client::get_sender(), method, &method_name, packed_args)
    }

    fn add_signature(claim: ExportClaim) -> Result<(), HostTypes::Error> {
        OpenTx::add_claim(psibase::Claim {
            service: claim.verify_service.parse().unwrap(),
            rawData: psibase::Hex::from(claim.raw_data),
        });
        Ok(())
    }

    fn add_evidence(claim: ExportClaim, proof: Vec<u8>) -> Result<(), HostTypes::Error> {
        OpenTx::check_connection(bindings::host::accounts::api::get_current_user())
            .map_err(ConnectionChanged)?;
        let service = claim
            .verify_service
            .parse()
            .map_err(|_| BadResponse("invalid evidence verifier"))?;
        OpenTx::add_evidence(
            psibase::Claim {
                service,
                rawData: claim.raw_data.into(),
            },
            proof.into(),
        )
        .map_err(|e| BadResponse(e).into())
    }

    fn set_propose_latch(account: Option<String>) -> Result<(), HostTypes::Error> {
        // Whitelisting host so that the host login prompts can stage transactions even when host is not the active app
        assert_authorized_with_whitelist(
            FunctionName::set_propose_latch,
            vec![Client::get_active_app(), String::from("host")],
        )?;

        let Some(acct) = account else {
            return flush_propose_latch();
        };

        if let Some(existing) = OpenTx::latch_sender() {
            if existing == acct {
                return Ok(());
            }
            flush_propose_latch()?;
        }
        OpenTx::open_latch(acct);
        Ok(())
    }

    fn propose(actions: Vec<ExportAction>, auto_exec: bool) -> Result<(), HostTypes::Error> {
        assert_authorized_with_whitelist(FunctionName::propose, vec!["packages".into()])?;

        let actions: Vec<psibase::Action> = actions
            .into_iter()
            .map(|a| ImportAction {
                sender: a.sender,
                service: a.service,
                method: a.method,
                raw_data: a.raw_data,
            })
            .map(TryInto::try_into)
            .collect::<Result<_, HostTypes::Error>>()?;
        let (service, method, packed) = pack_staged_propose(actions, auto_exec);
        schedule_action(service, method, packed)
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
        let actions = vec![ImportAction {
            sender: user.clone(),
            service: app,
            method: "loginSys".to_string(),
            raw_data: (root_host,).packed(),
        }];

        let claims: Vec<ImportClaim> = user_auth_claim(&user)?.into_iter().collect();

        let claims: Vec<psibase::Claim> = claims.into_iter().map(Into::into).collect();
        let actions: Vec<psibase::Action> = actions
            .into_iter()
            .map(TryInto::try_into)
            .collect::<Result<_, HostTypes::Error>>()?;

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
            user_auth_proof(&user, &Sha256::digest(&tx.packed()).into())?
                .into_iter()
                .map(|proof| Hex::from(proof.signature))
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

impl Authorized for TransactPlugin {
    fn graphql(query: String) -> Result<String, HostTypes::Error> {
        Server::post_graphql_get_json(&query)
    }
}

bindings::export!(TransactPlugin with_types_in bindings);

#[cfg(test)]
mod action_name_transport_tests {
    use super::*;

    #[test]
    fn invalid_numeric_ids_fail_before_any_host_call() {
        for id in [0, 1, 2u64 << 62] {
            assert!(validate_action_id(id).is_err());
            assert!(<TransactPlugin as Api>::add_action_id_to_transaction(id, vec![]).is_err());
        }
    }

    #[test]
    fn untrusted_text_is_fallible_and_hash_literals_are_exact() {
        for text in ["", "bad-name", "1bad", "é", "#short", "#0000000000000000"] {
            assert!(validate_action_name(text).is_err());
        }
        assert_eq!(
            validate_action_name("#ffffffffffffffff").unwrap().value,
            u64::MAX
        );
    }

    #[test]
    fn numeric_and_text_inputs_keep_the_same_wire_id() {
        for text in [
            "setKey",
            "requestRecovery",
            "set_guild_weight_curve",
            "#ffffffffffffffff",
        ] {
            let parsed = validate_action_name(text).unwrap();
            let (numeric, hook_text) = validate_action_id(parsed.value).unwrap();
            assert_eq!(numeric.value, parsed.value);
            assert_eq!(validate_action_name(&hook_text).unwrap(), parsed);
            let action = psibase::Action::try_from(ImportAction {
                sender: "alice".into(),
                service: "tokens".into(),
                method: text.into(),
                raw_data: vec![1, 2, 3],
            })
            .unwrap();
            assert_eq!(action.method, numeric);
            assert_eq!(action.rawData.0, vec![1, 2, 3]);
        }
    }
}
