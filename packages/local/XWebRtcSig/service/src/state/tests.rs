use super::{next_pending_seq, RemovedSocket};
use psibase::AccountNumber;

#[test]
fn removed_socket_final_when_no_remaining() {
    let user: AccountNumber = "alice".parse().unwrap();
    let removed = RemovedSocket {
        socket: 1,
        user,
        remaining_sockets: vec![],
    };
    assert!(removed.was_final_socket());
}

#[test]
fn removed_socket_not_final_when_tabs_remain() {
    let user: AccountNumber = "alice".parse().unwrap();
    let removed = RemovedSocket {
        socket: 1,
        user,
        remaining_sockets: vec![2],
    };
    assert!(!removed.was_final_socket());
}

#[test]
fn next_pending_seq_preserves_fifo_within_same_block() {
    assert_eq!(next_pending_seq(None, 100), 100);
    assert_eq!(next_pending_seq(Some(100), 100), 101);
    assert_eq!(next_pending_seq(Some(105), 100), 106);
    assert_eq!(next_pending_seq(Some(99), 100), 100);
}
