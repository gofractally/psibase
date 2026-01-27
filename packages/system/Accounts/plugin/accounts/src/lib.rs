#[allow(warnings)]
mod bindings;
mod db;
mod errors;
mod helpers;
mod interfaces;
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
        None => [is_logged_in, get_account, get_current_user, gen_rand_account],
        High => [set_auth_service, get_connected_apps],
        Max => [import_account, remove_account, get_all_accounts, get_auth_services],
    }
}

bindings::export!(AccountsPlugin with_types_in bindings);
