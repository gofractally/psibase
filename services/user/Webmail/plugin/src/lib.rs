#[allow(warnings)]
mod bindings;

use bindings::common::plugin::server::*;
use bindings::exports::webmail::plugin::api::{Error, Guest as API};
use psibase::fracpack::Pack;
use psibase::services::webmail;
use psibase::AccountNumber;

struct WebmailPlugin;

impl API for WebmailPlugin {
    fn send(receiver: String, subject: String, body: String) -> Result<(), Error> {
        add_action_to_transaction(
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
