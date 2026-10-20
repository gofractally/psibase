use psibase::AccountNumber;
use std::cell::{Cell, RefCell};
use std::collections::HashMap;

thread_local! {
    static BILLABLE_ACCOUNT: Cell<Option<AccountNumber>> = const { Cell::new(None) };
    static BILL_TO_SUB: RefCell<Option<HashMap<AccountNumber, String>>> = const { RefCell::new(None) };
}

pub fn get_billable_account() -> Option<AccountNumber> {
    BILLABLE_ACCOUNT.with(|cell| cell.get())
}

pub fn set_billable_account(account: AccountNumber) {
    BILLABLE_ACCOUNT.with(|cell| cell.set(Some(account)));
}

pub fn get_sub(user: AccountNumber) -> Option<String> {
    BILL_TO_SUB.with_borrow(|map| map.as_ref().and_then(|m| m.get(&user).cloned()))
}

pub fn set_sub(user: AccountNumber, sub_account: String) {
    BILL_TO_SUB.with_borrow_mut(|map| {
        map.get_or_insert_with(HashMap::new)
            .insert(user, sub_account);
    });
}
