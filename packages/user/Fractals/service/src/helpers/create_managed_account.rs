use psibase::services::{accounts, auth_dyn};
use psibase::AccountNumber;

pub fn create_managed_account<F>(new_account: AccountNumber, f: F)
where
    F: Fn(),
{
    accounts::Wrapper::call().newAccount(new_account, "auth-any".into(), true);

    f();

    auth_dyn::Wrapper::call_as(new_account).set_mgmt(new_account, crate::Wrapper::SERVICE);
    accounts::Wrapper::call_as(new_account).setAuthServ(auth_dyn::Wrapper::SERVICE)
}
