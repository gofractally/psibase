#[allow(warnings)]
mod bindings;

use bindings::exports::chainmail::plugin::api::{Error, Guest as API};
use bindings::transact::plugin::intf as Transact;
use psibase::fracpack::Pack;
use psibase::services::chainmail;
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
}

bindings::export!(ChainmailPlugin with_types_in bindings);
