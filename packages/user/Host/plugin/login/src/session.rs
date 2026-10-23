use crate::bindings::host::accounts::admin as HostAccounts;
use crate::bindings::host::auth::api as HostAuth;
use crate::bindings::host::types::types::Error;
use crate::bindings::transact::query_auth::api as QueryAuth;

pub(crate) fn login(user: &str, app: &str) -> Result<(), Error> {
    HostAccounts::connect(user, app);

    let token = match HostAuth::get_active_query_token(app, user) {
        Some(t) => t,
        None => QueryAuth::get_query_token(app, user)?,
    };
    HostAuth::set_session(user, app, &token);
    HostAccounts::set_current_user(user, app);
    Ok(())
}

pub(crate) fn logout(app: &str) {
    if let Some(user) = HostAccounts::clear_current_user(app) {
        HostAuth::clear_session(&user, app);
    }
}

pub(crate) fn disconnect(user: &str, app: &str) {
    HostAccounts::disconnect(user, app);
    if HostAccounts::revoke_login(user, app) {
        HostAuth::clear_session(user, app);
    }
}
