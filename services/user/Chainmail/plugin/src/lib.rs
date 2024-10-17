#[allow(warnings)]
mod bindings;
mod deser_structs;
mod errors;
mod queries;

use bindings::chainmail::plugin::types::Message;
use bindings::exports::chainmail::plugin::api::{Error, Guest as Api};
use bindings::exports::chainmail::plugin::queries::Guest as Query;
use bindings::host::common::server as CommonServer;
use bindings::transact::plugin::intf as Transact;
use deser_structs::TempMessageForDeserialization;
use errors::ErrorType;
use psibase::fracpack::Pack;
use psibase::AccountNumber;
use queries::query_messages_endpoint;

struct ChainmailPlugin;

fn get_msg_by_id(msg_id: u64) -> Result<TempMessageForDeserialization, Error> {
    let api_root = String::from("/api");

    let res = CommonServer::get_json(&format!("{}/messages?id={}", api_root, &msg_id.to_string()))?;
    println!("REST res msg_by_id: {:?}", res);

    let msg = serde_json::from_str::<Vec<TempMessageForDeserialization>>(&res)
        .map_err(|err| ErrorType::QueryResponseParseError.err(err.to_string().as_str()))?;

    if msg.len() == 1 {
        let msg = msg.get(0).unwrap();
        return Ok(msg.clone());
    } else {
        return Err(ErrorType::InvalidMsgId.err(&msg_id.to_string()));
    }
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

    // Save the message to state
    fn save(msg_id: u64) -> Result<(), Error> {
        let msg = get_msg_by_id(msg_id)?;

        Transact::add_action_to_transaction(
            "save",
            &chainmail::action_structs::save {
                subject: msg.subject.clone(),
                body: msg.body.clone(),
                receiver: AccountNumber::from(msg.receiver.as_str()),
                msg_id: msg.msg_id,
                sender: AccountNumber::from(msg.sender.as_str()),
                datetime: msg.datetime,
            }
            .packed(),
        )?;
        Ok(())
    }

    fn unsave(msg_id: u64) -> Result<(), Error> {
        let msg = get_msg_by_id(msg_id).unwrap();
        Transact::add_action_to_transaction(
            "save",
            &chainmail::action_structs::unsave {
                subject: msg.subject.clone(),
                body: msg.body.clone(),
                msg_id: msg.msg_id,
                sender: AccountNumber::from(msg.sender.as_str()),
                datetime: msg.datetime,
            }
            .packed(),
        )?;
        Ok(())
    }
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
