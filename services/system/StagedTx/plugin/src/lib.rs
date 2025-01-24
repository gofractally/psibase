#[allow(warnings)]
mod bindings;

use bindings::accounts::plugin::api::get_account;
use bindings::exports::staged_tx::plugin::api::Guest as Api;
use bindings::exports::transact_hook_tx_transform::{Guest as HookTxTransform, *};
use bindings::host::common::{client as Client, types::Error};
use bindings::transact::plugin::hooks::hook_tx_transform_label;
use psibase::services::staged_tx::action_structs::propose;
use psibase::{AccountNumber, Hex, MethodNumber};
use std::collections::HashMap;

use psibase::fracpack::Pack;

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

struct StagedTxPlugin;

impl Api for StagedTxPlugin {
    fn set_propose_latch(account: String) -> Result<(), Error> {
        validate_account(&account)?;
        hook_tx_transform_label(Some(account.as_str()));
        Ok(())
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
