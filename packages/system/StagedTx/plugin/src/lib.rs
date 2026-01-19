#[allow(warnings)]
mod bindings;

use bindings::*;

use accounts::plugin::api::get_account;
use exports::staged_tx::plugin::{proposer::Guest as Proposer, respondent::Guest as Respondent};
use exports::transact_hook_actions_sender::Guest as HookActionsSender;
use exports::transact_hook_tx_transform::{Guest as HookTxTransform, *};
use host::common::{client as Client, server as Server};
use host::types::types::Error;
use psibase::fracpack::Pack;
use psibase::services::staged_tx::action_structs::propose;
use psibase::{AccountNumber, Checksum256, Hex, MethodNumber};
use staged_tx::action_structs::*;
use transact::plugin::{hooks::*, intf::add_action_to_transaction};
mod db;
use db::*;

use serde::{Deserialize, Serialize};

mod errors;
use crate::trust::*;
use errors::ErrorType;

psibase::define_trust! {
    descriptions {
        Low => "",
        Medium => "",
        High => "
            - Accept staged transactions
            - Reject staged transactions
        
        Warning: This will grant the caller the ability to accept/reject transactions on your behalf! Make sure you completely trust the caller's legitimacy.
        ",
    }
    functions {
        None => [execute],
        Low => [],
        High => [accept, reject, remove],
        Max => [set_propose_latch, propose],
    }
}

fn validate_account(account: &str) -> Result<(), Error> {
    match get_account(account) {
        Ok(Some(_)) => Ok(()),
        Ok(None) => Err(ErrorType::InvalidAccount(account.to_string()).into()),
        Err(e) => Err(e),
    }
}

fn get_assert_caller(context: &str, allowed_apps: &[&str]) -> Result<(), Error> {
    let caller_app = Client::get_sender();
    if !allowed_apps.contains(&caller_app.as_str()) {
        return Err(ErrorType::Unauthorized(context.to_string(), caller_app.to_string()).into());
    }
    Ok(())
}

#[derive(Deserialize, Serialize)]
struct StagedTxDetails {
    data: StagedTxData,
}

#[derive(Deserialize, Serialize)]
struct StagedTxData {
    details: StagedTxDetailsInner,
}

#[derive(Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
struct StagedTxDetailsInner {
    txid: Checksum256,
    propose_block: u32,
    propose_date: String,
    proposer: String,
    action_list: ActionList,
}

#[derive(Deserialize, Serialize)]
struct ActionList {
    actions: Vec<ActionDetails>,
}

#[derive(Deserialize, Serialize)]
struct ActionDetails {
    sender: String,
    service: String,
    method: String,
    #[serde(rename = "rawData")]
    raw_data: String,
}

fn get_staged_txid(id: u32) -> Result<Checksum256, Error> {
    let query = format!(
        r#"query {{
            details(id: {id}) {{
                txid
                proposeBlock
                proposeDate
                proposer
                actionList {{
                    actions {{
                        sender
                        service
                        method
                        rawData
                    }}
                }}
            }}
        }}"#,
        id = id
    );

    let details = Server::post_graphql_get_json(&query).unwrap();
    let details = serde_json::from_str::<StagedTxDetails>(&details).unwrap();
    Ok(details.data.details.txid)
}

struct StagedTxPlugin;

/* TODO
 * Currently, to correctly use the propose latch requires that the user should call `set_propose_latch(None)`
 *   when they are finished.
 * To simplify usage, it would be better to return an owned resource that sets the propose latch on construction,
 *   and clears it on drop.
 * This depends on general support for passing wasm component resources.
*/

impl Proposer for StagedTxPlugin {
    fn set_propose_latch(account: Option<String>) -> Result<(), Error> {
        assert_authorized_with_whitelist(
            FunctionName::set_propose_latch,
            vec![Client::get_active_app()],
        )?;

        if let Some(acc) = &account {
            validate_account(acc)?;
            hook_actions_sender();
        } else {
            unhook_actions_sender();
        }

        hook_tx_transform_label(account.as_deref());
        CurrentSender::set(account);
        Ok(())
    }

    fn propose(actions: Vec<Action>, auto_exec: bool) -> Result<(), Error> {
        assert_authorized_with_whitelist(FunctionName::propose, vec!["packages".into()])?;

        add_action_to_transaction(
            propose::ACTION_NAME,
            &propose {
                actions: actions.into_iter().map(|a| a.into()).collect(),
                auto_exec,
            }
            .packed(),
        )
    }

    fn remove(id: u32) -> Result<(), Error> {
        assert_authorized(FunctionName::remove)?;
        add_action_to_transaction(
            remove::ACTION_NAME,
            &remove {
                id,
                txid: get_staged_txid(id)?,
            }
            .packed(),
        )
    }
}

impl Respondent for StagedTxPlugin {
    fn accept(id: u32) -> Result<(), Error> {
        assert_authorized_with_whitelist(
            FunctionName::accept,
            vec!["config".into(), "workshop".into()],
        )?;

        add_action_to_transaction(
            accept::ACTION_NAME,
            &accept {
                id,
                txid: get_staged_txid(id)?,
            }
            .packed(),
        )
    }

    fn reject(id: u32) -> Result<(), Error> {
        assert_authorized_with_whitelist(
            FunctionName::reject,
            vec!["config".into(), "workshop".into()],
        )?;

        add_action_to_transaction(
            reject::ACTION_NAME,
            &reject {
                id,
                txid: get_staged_txid(id)?,
            }
            .packed(),
        )
    }

    fn execute(id: u32) -> Result<(), Error> {
        assert_authorized(FunctionName::execute)?;
        add_action_to_transaction(
            execute::ACTION_NAME,
            &execute {
                id,
                txid: get_staged_txid(id)?,
            }
            .packed(),
        )
    }
}

impl HookTxTransform for StagedTxPlugin {
    fn on_tx_transform(
        label: Option<String>,
        actions: Vec<Action>,
    ) -> Result<Option<Vec<Action>>, Error> {
        let Some(label) = label else {
            return Ok(None);
        };

        let transact = psibase::services::transact::SERVICE.to_string();
        get_assert_caller("on_tx_transform", &[&transact])?;

        for action in &actions {
            if action.sender != label {
                return Err(ErrorType::InvalidSender(action.sender.clone()).into());
            }
        }

        let Some(sender) = accounts::plugin::api::get_current_user() else {
            return Err(ErrorType::NoCurrentUser.into());
        };

        let actions = vec![propose_wrap(sender, actions)];
        Ok(Some(actions))
    }
}

fn propose_wrap(sender: String, actions: Vec<Action>) -> Action {
    let actions: Vec<psibase::Action> = actions.into_iter().map(Into::into).collect();

    Action {
        sender,
        service: psibase::services::staged_tx::SERVICE.to_string(),
        method: propose::ACTION_NAME.to_string(),
        raw_data: propose {
            actions,
            auto_exec: true,
        }
        .packed(),
    }
}

impl From<Action> for psibase::Action {
    fn from(action: Action) -> Self {
        psibase::Action {
            sender: AccountNumber::from(action.sender.as_str()),
            service: AccountNumber::from(action.service.as_str()),
            method: MethodNumber::from(action.method.as_str()),
            rawData: Hex::from(action.raw_data),
        }
    }
}

impl HookActionsSender for StagedTxPlugin {
    fn on_actions_sender(_: String, _: String) -> Result<Option<String>, Error> {
        let transact = psibase::services::transact::SERVICE.to_string();
        get_assert_caller("on_actions_sender", &[&transact])?;

        Ok(CurrentSender::get())
    }
}

bindings::export!(StagedTxPlugin with_types_in bindings);
