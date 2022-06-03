// use fracpack::Packable;
use libpsibase::{
    abort_message, get_current_action, with_current_action, write_console, Action, MethodNumber,
    SharedAction,
};
use psi_macros::contract;

#[contract(example)]
mod example_contract {
    use crate::*;

    #[action]
    pub fn hi() {
        write_console("hello!!!");
    }

    #[action]
    pub fn add(a: i32, b: i32) -> i32 {
        a + b
    }

    #[action]
    pub fn multiply(a: i32, b: i32) -> i32 {
        a * b
    }
}
