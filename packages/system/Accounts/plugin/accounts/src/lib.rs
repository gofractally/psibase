#[allow(warnings)]
mod bindings;
mod db;
mod errors;
mod helpers;
mod interfaces;
#[path = "../../shared/logged_in_user_table.rs"]
mod logged_in_user;
mod plugin;

use plugin::AccountsPlugin;

psibase::define_trust! {
    descriptions {
        Low => "",
        Medium => "",
        High => "
            - Get a list of apps to which your account has been connected
            - Set auth service on an account

        Warning: This will grant the caller the ability to control how your account is authorized, including the capability to take control of your account! Make sure you completely trust the caller's legitimacy.
        ",
    }
    functions {
        None => [],
        High => [set_auth_service, get_connected_apps],
        Max => [import_account, remove_account, get_all_accounts, get_auth_services, preapprove_account],
    }
}

bindings::export!(AccountsPlugin with_types_in bindings);
