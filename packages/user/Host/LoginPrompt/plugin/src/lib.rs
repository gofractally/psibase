#[allow(warnings)]
mod bindings;
mod auth_service;
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
        Max => [import_existing, remove_account, get_all_accounts],
    }
}

bindings::export!(LoginPrompt with_types_in bindings);
