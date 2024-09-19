#[allow(warnings)]
mod bindings;

use bindings::exports::chainmail::plugin::api::{Error, Guest as API};
use bindings::transact::plugin::intf as Transact;
use psibase::fracpack::Pack;
use psibase::AccountNumber;

struct ChainmailPlugin;

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
}

bindings::export!(ChainmailPlugin with_types_in bindings);
