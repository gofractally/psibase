use crate::tx_cache::billable::{is_billed, set_billable_account, set_sub};
use psibase::account;

// The rule behind "a purchase raises the running transaction's CPU limit":
// the limit follows a balance only when that balance is the one being billed.
// One test, in order, because the per-transaction cache it reads is state of
// the thread and nothing else in the test program touches it.
#[test]
fn the_cpu_limit_follows_only_the_balance_being_billed() {
    let alice = account!("alice");
    let bob = account!("bob");
    let games = Some("games".to_string());
    let other = Some("other".to_string());

    // Outside a transaction nothing is billed.
    assert!(!is_billed(alice, &None));
    assert!(!is_billed(alice, &games));

    // transact names the billable account: its main balance is billed.
    set_billable_account(alice);
    assert!(is_billed(alice, &None));
    // A purchase for someone else, or into a sub-account that is not in use,
    // does not change what this transaction can afford.
    assert!(!is_billed(bob, &None));
    assert!(!is_billed(alice, &games));

    // Once billing moves to a sub-account, only that sub-account is billed.
    set_sub(alice, "games".to_string());
    assert!(is_billed(alice, &games));
    assert!(!is_billed(alice, &None));
    assert!(!is_billed(alice, &other));
    assert!(!is_billed(bob, &games));
}
