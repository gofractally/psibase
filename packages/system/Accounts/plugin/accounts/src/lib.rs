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
        High trust grants the abilities of all lower trust levels, plus these abilities:
            - Set auth service on an account
            - Get list of apps a user is connected to
        ",
    }
    functions {
        None => [is_logged_in, get_account, get_current_user, decode_connection_token],
        High => [set_auth_service, get_connected_apps],
        Max => [login_direct, import_account, get_all_accounts, get_auth_services],
    }
}

bindings::export!(AccountsPlugin with_types_in bindings);
