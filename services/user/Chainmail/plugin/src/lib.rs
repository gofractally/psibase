//! Chainmail Plugin: Basic Chainmail API
//!
//! Provides a convenient API for interacting with Chainmail, a simple email-like client.

#[allow(warnings)]
mod bindings;
mod errors;
mod queries;
mod serde_structs;

use bindings::exports::chainmail::plugin::{
    api::{Error, Guest as Api},
    queries::{Guest as Query, Message},
};
use bindings::transact::plugin::intf as Transact;
use psibase::fracpack::Pack;
use psibase::AccountNumber;
use queries::{get_msg_by_id, query_messages_endpoint};

/// Struct that implements the Api as well as the Query interfaces
struct ChainmailPlugin;

impl Api for ChainmailPlugin {
    /// Send a message
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

    /// Archive a message
    /// - msg_id: the message's rowid (from the events table)
    ///
    /// Archiving is equivalent to deleting, given message can't be truly deleted.
    /// Archiving is a proactive action equivalent to a node pruning an message (an message's historical event)
    fn archive(msg_id: u64) -> Result<(), Error> {
        Transact::add_action_to_transaction(
            "archive",
            &chainmail::action_structs::archive { msg_id }.packed(),
        )?;
        Ok(())
    }

    /// Save the message
    /// - msg_id: the message's rowid (from the events table)
    ///
    /// Saving a message moves it to state, making it long-lasting (immune to pruning)
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

    /// Unsave the message
    /// - msg_id: the message's rowid (from the events table)
    ///
    /// Unsaving a message removing it from state, exposing it to pruning
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
    /// Retrieve non-archived messages
    /// - Messages can be filtered by one or both of sender and/or receiver
    fn get_msgs(sender: Option<String>, receiver: Option<String>) -> Result<Vec<Message>, Error> {
        Ok(query_messages_endpoint(sender, receiver, false)?)
    }

    /// Retrieve archived messages
    /// - Messages can be filtered by one or both of sender and/or receiver
    fn get_archived_msgs(
        sender: Option<String>,
        receiver: Option<String>,
    ) -> Result<Vec<Message>, Error> {
        Ok(query_messages_endpoint(sender, receiver, true)?)
    }
}

bindings::export!(ChainmailPlugin with_types_in bindings);
