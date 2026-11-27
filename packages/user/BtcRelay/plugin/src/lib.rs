#[allow(warnings)]
mod bindings;
use bindings::exports::btcrelay::plugin::api::{Guest, SignetBlock};
use bindings::host::types::types::Error;

psibase::define_trust! {
    descriptions { Low => "Relay Bitcoin block headers from your Psibase account", Medium => "", High => "", }
    functions { Low => [headers, signet_headers], }
}
struct Plugin;
impl Guest for Plugin {
    fn headers(headers: Vec<String>) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::headers)?;
        bindings::transact::plugin::api::add_action_to_transaction(
            "headers",
            &psio::to_pssz(&btcrelay::action_structs::headers { headers }),
        )
    }
    fn signet_headers(blocks: Vec<SignetBlock>) -> Result<(), Error> {
        trust::assert_authorized(trust::FunctionName::signet_headers)?;
        let blocks = blocks
            .into_iter()
            .map(|b| btcrelay::SignetBlock {
                header: b.header,
                coinbase: b.coinbase,
                branch: b.branch,
            })
            .collect();
        bindings::transact::plugin::api::add_action_to_transaction(
            "signetHeaders",
            &psio::to_pssz(&btcrelay::action_structs::signetHeaders { blocks }),
        )
    }
}
bindings::export!(Plugin with_types_in bindings);
