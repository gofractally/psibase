use psibase::services::{accounts, auth_delegate, auth_dyn};
use psibase::{get_service, AccountNumber, ServiceWrapper};

/// Create `new_account` owned by this service, then switch it to AuthDyn
/// managed by this service. Subaccounts are preapproved so AuthDelegate
/// can create them; the parent must already exist.
pub fn create_managed_account<F>(new_account: AccountNumber, f: F)
where
    F: Fn(),
{
    let self_service = get_service();
    if new_account.is_subaccount() {
        accounts::Wrapper::call_as(new_account.base()).preapproveAcc(new_account);
    }
    auth_delegate::Wrapper::call().newAccount(new_account, self_service, true);

    f();

    auth_dyn::Wrapper::call_as(new_account).set_mgmt(new_account, self_service);
    accounts::Wrapper::call_as(new_account).setAuthServ(auth_dyn::Wrapper::SERVICE)
}