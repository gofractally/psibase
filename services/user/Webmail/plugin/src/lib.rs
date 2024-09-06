#[allow(warnings)]
mod bindings;

use bindings::exports::webmail::plugin::api::{Error, Guest as API};
use bindings::host::common::server::*;
use bindings::transact::plugin::intf as Transact;
use psibase::fracpack::Pack;
use psibase::services::webmail;
use psibase::AccountNumber;

struct WebmailPlugin;

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

bindings::export!(WebmailPlugin with_types_in bindings);
