#[allow(warnings)]
mod bindings;
mod errors;
mod interfaces;
mod plugin;

pub(crate) const HOST_APP: &str = "host";

use plugin::LoginPrompt;

psibase::define_trust! {
    descriptions {
        Low => "",
        Medium => "",
        High => "",
    }
    functions {
        Max => [remove_account, get_all_accounts],
    }
}

bindings::export!(LoginPrompt with_types_in bindings);
