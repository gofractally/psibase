#[allow(warnings)]
mod bindings;
mod errors;
mod interfaces;
mod plugin;

use plugin::AccountsPlugin;

psibase::define_trust! {
    descriptions {
        Low => "",
        Medium => "",
        High => "
            - Set auth service on an account

        Warning: This will grant the caller the ability to control how your account is authorized, including the capability to take control of your account! Make sure you completely trust the caller's legitimacy.
        ",
    }
    functions {
        None => [],
        High => [set_auth_service],
        Max => [get_auth_services, preapprove_account],
    }
}

bindings::export!(AccountsPlugin with_types_in bindings);
