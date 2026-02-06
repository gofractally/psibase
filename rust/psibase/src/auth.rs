use crate::services::{
    accounts,
    transact::{auth_interface::auth_action_structs, ServiceMethod},
};
use crate::{get_service, AccountNumber, Caller, MethodNumber, ServiceCaller};

/// Looks up the sender's auth service and checks if it would authorize the specified
/// action by the sender given the specified authorizers.
///
/// If no action is specified, the auth service reports whether the authorization is sufficient
/// to call all actions.
pub fn is_auth(
    sender: AccountNumber,
    service_method: Option<ServiceMethod>,
    authorizers: Vec<AccountNumber>,
) -> bool {
    let Some(acc) = accounts::Wrapper::call().getAccount(sender) else {
        return false;
    };

    ServiceCaller {
        sender: get_service(),
        service: acc.authService,
        flags: 0,
    }
    .call(
        MethodNumber::from(auth_action_structs::isAuthSys::ACTION_NAME),
        auth_action_structs::isAuthSys {
            sender,
            authorizers,
            method: service_method,
            authSet: None,
        },
    )
}
