use psibase::services::accounts::Wrapper as Accounts;
use psibase::services::transact::auth_interface::auth_action_structs;
use psibase::{AccountNumber, Caller, MethodNumber, ServiceCaller};

use crate::service::Wrapper;

pub fn get_auth_service(sender: AccountNumber) -> Option<AccountNumber> {
    Accounts::call().getAccount(sender).map(|a| a.authService)
}

pub struct StagedTxPolicy {
    user: AccountNumber,
    service_caller: ServiceCaller,
}
impl StagedTxPolicy {
    pub fn new(user: AccountNumber) -> Option<Self> {
        Some(StagedTxPolicy {
            user,
            service_caller: ServiceCaller {
                sender: Wrapper::SERVICE,
                service: get_auth_service(user)?,
            },
        })
    }

    pub fn does_auth(&self, accepters: Vec<AccountNumber>) -> bool {
        self.service_caller.call(
            MethodNumber::from(auth_action_structs::isAuthSys::ACTION_NAME),
            auth_action_structs::isAuthSys {
                sender: self.user,
                authorizers: accepters,
                authSet: None,
            },
        )
    }

    pub fn does_reject(&self, rejecters: Vec<AccountNumber>) -> bool {
        self.service_caller.call(
            MethodNumber::from(auth_action_structs::isRejectSys::ACTION_NAME),
            auth_action_structs::isRejectSys {
                sender: self.user,
                rejecters,
                authSet: None,
            },
        )
    }
}
