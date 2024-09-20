#[allow(warnings)]
mod bindings;
mod errors;

use crate::bindings::host::common::server;
use bindings::exports::chainmail::plugin::api::{Error, Guest as API};
use bindings::transact::plugin::intf as Transact;
use errors::ErrorType;
use psibase::fracpack::Pack;
use psibase::AccountNumber;
use serde::Deserialize;

struct ChainmailPlugin;

#[derive(Deserialize, Debug)]
struct Message {
    receiver: AccountNumber,
    subject: String,
    body: String,
}

impl API for ChainmailPlugin {
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

    fn archive(event_id: u64) -> Result<(), Error> {
        Transact::add_action_to_transaction(
            "archive",
            &chainmail::action_structs::archive { event_id }.packed(),
        )?;
        Ok(())
    }

    fn save(event_id: u64) -> Result<(), Error> {
        // look up message details via event_id
        // let (sender, receiver, subject, body) = fetch.get(/rest/message by id);
        let res = server::get_json(&format!("/messages?id={}", event_id))?;

        let msg = serde_json::from_str::<Message>(&res)
            .map_err(|err| ErrorType::QueryResponseParseError.err(err.to_string().as_str()))?;

        // save the message to state
        Transact::add_action_to_transaction(
            "save",
            &chainmail::action_structs::save {
                receiver: msg.receiver,
                subject: msg.subject,
                body: msg.body,
            }
            .packed(),
        )?;
        Ok(())
    }
}

bindings::export!(ChainmailPlugin with_types_in bindings);
