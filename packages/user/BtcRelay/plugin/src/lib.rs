#[allow(warnings)]
mod bindings;
use bindings::exports::btcrelay::plugin::api::Guest;
use bindings::host::types::types::Error;
use psibase::fracpack::Pack;
psibase::define_trust! {
    descriptions { Low => "Relay Bitcoin block headers from your Psibase account", Medium => "", High => "", }
    functions { Low => [headers], }
}
struct Plugin;
impl Guest for Plugin {
    fn headers(headers: Vec<String>) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::headers)?;
        bindings::transact::plugin::api::add_action_to_transaction(
            "headers",
            &btcrelay::action_structs::headers { headers }.packed(),
        )
    }
}
bindings::export!(Plugin with_types_in bindings);
