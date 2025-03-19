//! Chainmail Plugin: Basic Chainmail API
//!
//! Provides a convenient API for interacting with Chainmail, a simple email-like client.

#[allow(warnings)]
mod bindings;
mod errors;
mod queries;
mod serde_structs;

use bindings::accounts::plugin as AccountPlugin;
use bindings::exports::chainmail::plugin::{
    api::{Error, Guest as Api},
    queries::{Guest as Query, Message},
};
use bindings::host::common::server as CommonServer;
use bindings::transact::plugin::intf as Transact;
use chrono::DateTime;
use errors::ErrorType;
use psibase::fracpack::Pack;
use psibase::AccountNumber;
use queries::{get_msg_by_id, query_messages_endpoint};
use serde_structs::TempMessageForDeserGqlResponse;

struct ChainmailPlugin;

fn get_unix_time_from_iso8601_str(dt_str: String) -> Result<i64, Error> {
    Ok(DateTime::parse_from_str(dt_str.as_str(), "%+")
        .map_err(|e| ErrorType::DateTimeConversion(e.to_string()))?
        .timestamp())
}

impl Api for ChainmailPlugin {
    fn send(receiver: String, subject: String, body: String) -> Result<(), Error> {
        Transact::add_action_to_transaction(
            "send",
            &chainmail::action_structs::send {
                receiver: AccountNumber::from(receiver.as_str()),
                subject,
                body,
            }
            .packed(),
        )?;
        Ok(())
    }

    fn archive(msg_id: u64) -> Result<(), Error> {
        Transact::add_action_to_transaction(
            "archive",
            &chainmail::action_structs::archive { msg_id }.packed(),
        )?;
        Ok(())
    }

    fn save(msg_id: u64) -> Result<(), Error> {
        let msg = get_msg_by_id(msg_id)?;

        Transact::add_action_to_transaction(
            "save",
            &chainmail::action_structs::save {
                subject: msg.subject,
                body: msg.body,
                receiver: AccountNumber::from(msg.receiver.as_str()),
                msg_id: msg.msg_id,
                sender: AccountNumber::from(msg.sender.as_str()),
                datetime: get_unix_time_from_iso8601_str(msg.datetime)?,
            }
            .packed(),
        )?;
        Ok(())
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
            None => AccountPlugin::api::get_current_user()?.expect("No receiver specified"),
        };
        // lib: construct gql query from types; generate schema
        // - generate obj based on gql schema with query methods on it
        let graphql_str = format!(
            "query {{ getSavedMsgs(receiver:\"{}\") {{ nodes {{ msgId, receiver, sender, subject, body, datetime }} }} }}",
            rcvr
        );

        let gql_res_str = CommonServer::post_graphql_get_json(&graphql_str)?;
        let summary_val = serde_json::from_str::<TempMessageForDeserGqlResponse>(&gql_res_str)
            .map_err(|err| ErrorType::QueryResponseParseError(err.to_string()))?;

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
