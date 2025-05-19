//! Chainmail Plugin: Basic Chainmail API
//!
//! Provides a convenient API for interacting with Chainmail, a simple email-like client.

#[allow(warnings)]
mod bindings;
use bindings::*;

mod errors;
use errors::ErrorType::*;

mod queries;
mod serde_structs;

use accounts::plugin::api::get_current_user;
use chrono::DateTime;
use exports::chainmail::plugin::{
    api::{Error, Guest as Api},
    queries::{Guest as Query, Message},
};
use host::common::server as CommonServer;
use psibase::{fracpack::Pack, services::chainmail::action_structs as Actions, HasActionName};
use queries::{get_msg_by_id, query_messages_endpoint};
use serde_structs::{ResponseRoot, TempMessageForDeserGqlResponseData};
use transact::plugin::intf as Transact;

struct ChainmailPlugin;

pub fn schedule_action<T: HasActionName + Pack>(action: T) -> Result<(), Error> {
    Transact::add_action_to_transaction(T::ACTION_NAME, &action.packed())
}

fn get_unix_time_from_iso8601_str(dt_str: String) -> Result<i64, Error> {
    Ok(DateTime::parse_from_str(dt_str.as_str(), "%+")
        .map_err(|e| DateTimeConversion(e.to_string()))?
        .timestamp())
}

impl Api for ChainmailPlugin {
    fn send(receiver: String, subject: String, body: String) -> Result<(), Error> {
        schedule_action(Actions::send {
            receiver: receiver.as_str().into(),
            subject,
            body,
        })
    }

    fn archive(msg_id: u64) -> Result<(), Error> {
        schedule_action(Actions::archive { msg_id })
    }

    fn save(msg_id: u64) -> Result<(), Error> {
        let msg = get_msg_by_id(msg_id)?;

        schedule_action(Actions::save {
            subject: msg.subject,
            body: msg.body,
            receiver: msg.receiver.as_str().into(),
            msg_id: msg.msg_id,
            sender: msg.sender.as_str().into(),
            datetime: get_unix_time_from_iso8601_str(msg.datetime)?,
        })
    }
}

impl Query for ChainmailPlugin {
    fn get_msgs(sender: Option<String>, receiver: Option<String>) -> Result<Vec<Message>, Error> {
        let inbox_msgs = query_messages_endpoint(sender, receiver.clone(), false)?;
        let mut saved_msgs = Self::get_saved_msgs(receiver)?;

        for msg in &mut saved_msgs {
            msg.is_saved_msg = true;
        }

        let mut all_msgs = [inbox_msgs, saved_msgs].concat();
        all_msgs.sort();
        all_msgs.dedup();
        all_msgs.sort_by_key(|k| k.datetime.clone());
        Ok(all_msgs)
    }

    fn get_archived_msgs(
        sender: Option<String>,
        receiver: Option<String>,
    ) -> Result<Vec<Message>, Error> {
        Ok(query_messages_endpoint(sender, receiver, true)?)
    }

    fn get_saved_msgs(receiver: Option<String>) -> Result<Vec<Message>, Error> {
        let rcvr = match receiver {
            Some(r) => r,
            None => get_current_user()?.expect("No receiver specified"),
        };
        // lib: construct gql query from types; generate schema
        // - generate obj based on gql schema with query methods on it

        let graphql_str = format!(
            r#"query {{
                getSavedMsgs(receiver: "{receiver}") {{
                    nodes {{ msgId, receiver, sender, subject, body, datetime }}
                }}
            }}"#,
            receiver = rcvr
        );

        let gql_res_str = CommonServer::post_graphql_get_json(&graphql_str)?;
        let summary_val =
            serde_json::from_str::<ResponseRoot<TempMessageForDeserGqlResponseData>>(&gql_res_str)
                .map_err(|err| QueryResponseParseError(err.to_string()))?;

        Ok(summary_val
            .data
            .getSavedMsgs
            .nodes
            .into_iter()
            .map(|m| m.into())
            .collect())
    }
}

bindings::export!(ChainmailPlugin with_types_in bindings);
