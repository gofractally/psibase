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
        None => "
            - Check if user is logged in
            - Get account details
            - Get current user
            - Decode connection token
        ",
        High => "
        High trust grants the abilities of all lower trust levels, plus these abilities:
            - Set auth service on an account
            - Get list of apps a user is connected to
        ",
        Max => "
        Max trust grants the abilities of all lower trust levels, plus these abilities:
            - Login a user to an app
            - Import (keys for) an account
            - Get list of all accounts
            - Get list of auth services
        ",
    }
    functions {
        None => [is_logged_in, get_account, get_current_user, decode_connection_token],
        Low => [],
        High => [set_auth_service, get_connected_apps],
        Max => [login_direct, import_account, get_all_accounts, get_auth_services],
    }
}

bindings::export!(AccountsPlugin with_types_in bindings);
