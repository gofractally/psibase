#[allow(warnings)]
mod bindings;
mod apps_table;
mod errors;
mod prompt;

pub struct AccountsPrompt;

psibase::define_trust! {
    descriptions {
        Low => "",
        Medium => "",
        High => "",
    }
    functions {
        Max => [import_existing],
    }
}

bindings::export!(AccountsPrompt with_types_in bindings);
