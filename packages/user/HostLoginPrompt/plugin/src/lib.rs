#[allow(warnings)]
mod bindings;
mod errors;
mod helpers;
mod interfaces;
mod plugin;

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
