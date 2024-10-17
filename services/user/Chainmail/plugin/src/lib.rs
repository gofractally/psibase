#[allow(warnings)]
mod bindings;
mod deser_structs;
mod errors;
mod queries;

use bindings::chainmail::plugin::types::Message;
use bindings::exports::chainmail::plugin::api::{Error, Guest as Api};
use bindings::exports::chainmail::plugin::queries::Guest as Query;
use bindings::transact::plugin::intf as Transact;
use psibase::fracpack::Pack;
use psibase::AccountNumber;
use queries::{get_msg_by_id, query_messages_endpoint};

struct ChainmailPlugin;

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
