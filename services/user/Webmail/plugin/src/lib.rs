#[allow(warnings)]
mod bindings;

use bindings::exports::webmail::plugin::api::{Error, Guest as API};
// use bindings::exports::webmail::plugin::queries::Guest as Query;
// use bindings::exports::webmail::plugin::types::Message;
// use bindings::host::common::server::Error as CommonError;
use bindings::host::common::server::*;
use bindings::transact::plugin::intf as Transact;
use psibase::fracpack::Pack;
use psibase::services::webmail;
use psibase::AccountNumber;

struct WebmailPlugin;

// struct Message {
//     receiver: String,
//     sender: String,
//     subject: String,
//     content: String,
// }

impl API for WebmailPlugin {
    fn send(receiver: String, subject: String, body: String) -> Result<(), Error> {
        Transact::add_action_to_transaction(
            "send",
            &webmail::action_structs::send {
                receiver: AccountNumber::from(receiver.as_str()),
                subject,
                body,
            }
            .packed(),
        )?;
        Ok(())
    }
}

// impl Query for WebmailPlugin {
//     fn get_messages(sender: String, receiver: String) -> Result<Vec<Message>, CommonError> {
//         Ok(vec![])
//     }
// }

bindings::export!(WebmailPlugin with_types_in bindings);
