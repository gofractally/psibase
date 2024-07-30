#[allow(warnings)]
mod bindings;

use bindings::common::plugin::server::*;
use bindings::exports::email::plugin::api::{Error, Guest as API};
use psibase::fracpack::Pack;
use psibase::services::email;
use psibase::AccountNumber;

struct EmailPlugin;

impl API for EmailPlugin {
    fn send(recipient: String, subject: String, body: String) -> Result<(), Error> {
        add_action_to_transaction(
            "send",
            &email::action_structs::send {
                recipient: AccountNumber::from(recipient.as_str()),
                subject,
                body,
            }
            .packed(),
        )?;
        Ok(())
    }
}

bindings::export!(EmailPlugin with_types_in bindings);
