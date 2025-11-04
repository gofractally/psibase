#[allow(warnings)]
mod bindings;
mod db;
mod errors;
mod helpers;
mod interfaces;
mod plugin;
mod tokens;

use plugin::AccountsPlugin;

psibase::define_trust! {
    descriptions {
        Low => "",
        Medium => "",
        High => "
        🚨 WARNING 🚨 
        This approval will grant the caller the ability to control how your account is authorized, including the capability to take control of your account! Make sure you completely trust the caller's legitimacy.

        In addition, this approval grants the caller the following abilities:
            - Get a list of apps to which your account has been connected
            - Set auth service on an account
        ",
    }
    functions {
        None => [is_logged_in, get_account, get_current_user, decode_connection_token],
        High => [set_auth_service, get_connected_apps],
        Max => [login_direct, import_account, get_all_accounts, get_auth_services],
    }
}

bindings::export!(AccountsPlugin with_types_in bindings);
