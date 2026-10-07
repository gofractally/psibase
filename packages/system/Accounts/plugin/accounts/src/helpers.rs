use crate::bindings::accounts::query::api as AccountsQuery;

pub fn assert_valid_account(account: &str) {
    let account_details = AccountsQuery::get_account(account).expect("Get account failed");
    assert!(account_details.is_some(), "Invalid account name");
}
