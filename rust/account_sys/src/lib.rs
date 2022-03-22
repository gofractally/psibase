use psibase::*;

#[psi_macros::contract(example_iface)]
mod example_impl {
    use crate::*;

    #[derive(psi_macros::Fracpack)]
    pub struct AccountName {
        num: AccountNum,
        name: String,
    }

    #[action]
    #[allow(unused_variables)]
    pub fn startup(next_account_num: AccountNum, existing_accounts: Vec<AccountName>) {
        write_console("**** startup\n");
        abort_message("**** startup\n");
    }

    #[action]
    #[allow(unused_variables)]
    pub fn create_account(name: String, auth_contract: String, allow_sudo: bool) -> AccountNum {
        write_console("**** create_account\n");
        abort_message("**** create_account\n");
    }
}

#[no_mangle]
pub extern "C" fn called(_this_contract: AccountNum, _sender: AccountNum) {
    write_console("**** called\n");
    abort_message("called");
}

extern "C" {
    fn __wasm_call_ctors();
}

#[no_mangle]
pub extern "C" fn start(_this_contract: AccountNum) {
    unsafe {
        __wasm_call_ctors();
        write_console("**** start\n");
    }
}
