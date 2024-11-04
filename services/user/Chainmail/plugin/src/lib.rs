#[allow(warnings)]
mod bindings;
mod errors;

use bindings::exports::chainmail::plugin::api::{Error, Guest as Api};
use bindings::exports::chainmail::plugin::queries::{Guest as Query, Message};
use bindings::host::common::server as CommonServer;
use bindings::transact::plugin::intf as Transact;
use errors::ErrorType::QueryResponseParseError;
use psibase::fracpack::Pack;
use psibase::AccountNumber;
use serde::Deserialize;

struct ChainmailPlugin;

#[derive(Debug, Deserialize)]
struct MessageSerde {
    msg_id: String,
    receiver: String,
    sender: String,
    subject: String,
    body: String,
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
}

fn query_messages_endpoint(
    sender: Option<String>,
    receiver: Option<String>,
    archived_requested: bool,
) -> Result<Vec<Message>, Error> {
    let mut endpoint = String::from("/api/messages?");
    if archived_requested {
        endpoint += "archived=true&";
    }
    if sender.is_some() {
        endpoint += &format!("sender={}", sender.clone().unwrap());
    }
    if sender.is_some() && receiver.is_some() {
        endpoint += "&";
    }
    if receiver.is_some() {
        endpoint += &format!("receiver={}", receiver.unwrap());
    }

    let resp = serde_json::from_str::<Vec<MessageSerde>>(&CommonServer::get_json(&endpoint)?);
    let mut resp_val: Vec<MessageSerde>;
    if resp.is_err() {
        return Err(
            errors::ErrorType::QueryResponseParseError(resp.unwrap_err().to_string()).into(),
        );
    } else {
        resp_val = resp.unwrap();
    }

    // There's a way to tell the bindgen to generate the rust types with custom attributes. Goes in cargo.toml.
    // Somewhere in the codebase is an example of doing this with serde serialize and deserialize attributes
    let messages: Vec<Message> = resp_val
        .into_iter()
        .map(|m| Message {
            msg_id: m
                .msg_id
                .parse::<u64>()
                .map_err(|err| QueryResponseParseError(err.to_string()))
                .unwrap(),
            receiver: m.receiver,
            sender: m.sender,
            subject: m.subject,
            body: m.body,
        })
        .collect();
    Ok(messages)
}

impl Query for ChainmailPlugin {
    fn get_msgs(sender: Option<String>, receiver: Option<String>) -> Result<Vec<Message>, Error> {
        Ok(query_messages_endpoint(sender, receiver, false)?)
    }

    fn get_archived_msgs(
        sender: Option<String>,
        receiver: Option<String>,
    ) -> Result<Vec<Message>, Error> {
        Ok(query_messages_endpoint(sender, receiver, true)?)
    }
}

bindings::export!(ChainmailPlugin with_types_in bindings);
