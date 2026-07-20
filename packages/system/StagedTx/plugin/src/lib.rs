#[allow(warnings)]
mod bindings;

use bindings::*;

use exports::staged_tx::plugin::{proposer::Guest as Proposer, respondent::Guest as Respondent};
use host::common::server as Server;
use host::types::types::Error;
use psibase::fracpack::Pack;
use psibase::Checksum256;
use staged_tx::action_structs::*;
use transact::plugin::intf::add_action_to_transaction;

use serde::{Deserialize, Serialize};

use crate::trust::*;

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
        Max => [],
    }
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

impl Proposer for StagedTxPlugin {
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

bindings::export!(StagedTxPlugin with_types_in bindings);
