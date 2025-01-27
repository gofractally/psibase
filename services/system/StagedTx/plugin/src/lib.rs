#[allow(warnings)]
mod bindings;

use bindings::accounts::plugin::api::get_account;
use bindings::exports::staged_tx::plugin::{
    proposer::Guest as Proposer, respondent::Guest as Respondent,
};
use bindings::exports::transact_hook_tx_transform::{Guest as HookTxTransform, *};
use bindings::host::common::{client as Client, server as Server, types::Error};
use bindings::transact::plugin::{hooks::hook_tx_transform_label, intf::add_action_to_transaction};
use psibase::fracpack::Pack;
use psibase::services::staged_tx::action_structs::propose;
use psibase::{AccountNumber, Checksum256, Hex, MethodNumber};
use staged_tx::action_structs::*;
use std::collections::HashMap;

use serde::{Deserialize, Serialize};

mod errors;
use errors::ErrorType;

fn validate_account(account: &str) -> Result<(), Error> {
    match get_account(account) {
        Ok(Some(_)) => Ok(()),
        Ok(None) => Err(ErrorType::InvalidAccount(account.to_string()).into()),
        Err(e) => Err(e),
    }
}

fn get_assert_caller(context: &str, allowed_apps: &[&str]) -> Result<(), Error> {
    let caller = Client::get_sender_app();
    let caller_app = caller.app.as_ref().unwrap();
    if caller.app.is_none() || !allowed_apps.contains(&caller_app.as_str()) {
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
struct StagedTxDetailsInner {
    txid: String,
    #[serde(rename = "proposeBlock")]
    propose_block: u32,
    #[serde(rename = "proposeDate")]
    propose_date: String,
    proposer: String,
    #[serde(rename = "actionList")]
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
    let txid = details.data.details.txid;
    if txid.len() % 2 != 0 {
        return Err(ErrorType::InvalidTxId.into());
    }
    let txid: Vec<u8> = (0..txid.len())
        .step_by(2)
        .map(|i| u8::from_str_radix(&txid[i..i + 2], 16).unwrap())
        .collect();
    let txid: [u8; 32] = txid.try_into().map_err(|_| ErrorType::InvalidTxId)?;

    Ok(txid.into())
}

struct StagedTxPlugin;

impl Proposer for StagedTxPlugin {
    fn set_propose_latch(account: String) -> Result<(), Error> {
        validate_account(&account)?;
        hook_tx_transform_label(Some(account.as_str()));
        Ok(())
    }

    fn remove(id: u32) -> Result<(), Error> {
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
        add_action_to_transaction(
            reject::ACTION_NAME,
            &reject {
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

        // There is typically only one sender for a set of actions, but in rare cases where
        // hooks were used to simultaneously execute actions from multiple users *and* a propose
        // latch was set, the result is:
        // 1. Multiple staged transactions are proposed, one for each sender.
        // 2. The actions contained in a staged transaction correspond to the actions originally executed by sender.
        // 3. The new sender of the staged actions correspond to the latch that was set at the time the action was scheduled.

        let action_groups = group_by_sender(actions);
        let actions = action_groups
            .into_iter()
            .map(|group| propose_wrap(group, &label))
            .collect();

        Ok(Some(actions))
    }
}

fn propose_wrap(mut actions: Vec<Action>, label: &str) -> Action {
    let sender = actions[0].sender.clone();

    for action in &mut actions {
        action.sender = label.to_string();
    }

    let actions: Vec<psibase::Action> = actions.into_iter().map(Into::into).collect();

    Action {
        sender,
        service: psibase::services::staged_tx::SERVICE.to_string(),
        method: propose::ACTION_NAME.to_string(),
        raw_data: propose { actions }.packed(),
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

fn group_by_sender(actions: Vec<Action>) -> Vec<Vec<Action>> {
    let mut sender_groups: HashMap<String, Vec<Action>> = HashMap::new();

    for action in actions {
        sender_groups
            .entry(action.sender.clone())
            .or_default()
            .push(action);
    }

    sender_groups.into_values().collect()
}

bindings::export!(StagedTxPlugin with_types_in bindings);
