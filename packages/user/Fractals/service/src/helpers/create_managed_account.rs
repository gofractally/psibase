use psibase::services::{accounts, auth_delegate, auth_dyn};
use psibase::{AccountNumber, Call};

pub fn create_managed_account<F>(new_account: AccountNumber, f: F)
where
    F: Fn(),
{
    let self_service = crate::Wrapper::SERVICE;
    auth_delegate::Wrapper::call().newAccount(new_account, self_service, true);

    f();

    auth_dyn::Wrapper::call_as(new_account).set_mgmt(new_account, self_service);
    accounts::Wrapper::call_as(new_account).setAuthServ(auth_dyn::Wrapper::SERVICE)
}
