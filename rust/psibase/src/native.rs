//! Wrapped native functions for services to use
//!
//! Native functions give services the ability to print debugging messages,
//! abort transactions on errors, access databases and event logs, and
//! synchronously call other services. There aren't many native functions
//! since services implement most psibase functionality.
//!
//! These functions wrap the [Raw Native Functions](crate::native_raw).

use crate::native_raw;
use fracpack::Packable;

/// Write message to console
///
/// Message should be UTF8.
pub fn write_console_bytes(message: &[u8]) {
    unsafe {
        if let Some(first) = message.first() {
            native_raw::writeConsole(first, message.len() as u32);
        }
    }
}

/// Write message to console
pub fn write_console(message: &str) {
    write_console_bytes(message.as_bytes());
}

/// Abort with message
///
/// Message should be UTF8.
pub fn abort_message_bytes(message: &[u8]) -> ! {
    unsafe {
        if let Some(first) = message.first() {
            native_raw::abortMessage(first, message.len() as u32)
        } else {
            native_raw::abortMessage(std::ptr::null(), 0)
        }
    }
}

/// Abort with message
pub fn abort_message(message: &str) -> ! {
    abort_message_bytes(message.as_bytes());
}

/// Abort with message if condition is false
pub fn check(condition: bool, message: &str) {
    if !condition {
        abort_message_bytes(message.as_bytes());
    }
}

/// Get the most-recent result when the size is known in advance
///
/// Other functions set the result.
fn get_result_bytes(size: u32) -> Vec<u8> {
    let mut result = Vec::with_capacity(size as usize);
    if size > 0 {
        unsafe {
            let actual_size = native_raw::getResult(result.as_mut_ptr(), size, 0);
            result.set_len(std::cmp::min(size, actual_size) as usize);
        }
    }
    result
}

/// Get the most-recent key
///
/// Other functions set the key.
pub fn get_key() -> Vec<u8> {
    unsafe {
        let size = native_raw::getKey(std::ptr::null_mut(), 0);
        let mut result = Vec::with_capacity(size as usize);
        if size > 0 {
            native_raw::getKey(result.as_mut_ptr(), size);
            result.set_len(size as usize);
        }
        result
    }
}

/// Get the currently-executing action.
///
/// If the contract, while handling action A, calls itself with action B:
///    * Before the call to B, [get_current_action] returns A.
///    * After the call to B, [get_current_action] returns B.
///    * After B returns, [get_current_action] returns A.
///
/// Note: The above only applies if the contract uses [crate::native_raw::call].
pub fn get_current_action_bytes() -> Vec<u8> {
    let size;
    unsafe {
        size = native_raw::getCurrentAction();
    };
    get_result_bytes(size)
}

/// Get the currently-executing action.
///
/// This version creates an extra copy of [crate::Action::rawData];
/// consider using [with_current_action] instead.
///
/// If the contract, while handling action A, calls itself with action B:
///    * Before the call to B, [get_current_action] returns A.
///    * After the call to B, [get_current_action] returns B.
///    * After B returns, [get_current_action] returns A.
///
/// Note: The above only applies if the contract uses [crate::native_raw::call].
pub fn get_current_action() -> crate::Action {
    let bytes = get_current_action_bytes();
    <crate::Action>::unpack(&bytes[..], &mut 0).unwrap() // unwrap won't panic
}

/// Get the currently-executing action and pass it to `f`.
///
/// This is more efficient than [get_current_action] since it avoids
/// creating an extra copy of [crate::Action::rawData].
///
/// If the contract, while handling action A, calls itself with action B:
///    * Before the call to B, [get_current_action] returns A.
///    * After the call to B, [get_current_action] returns B.
///    * After B returns, [get_current_action] returns A.
///
/// Note: The above only applies if the contract uses [crate::native_raw::call].
pub fn with_current_action<R, F: Fn(crate::SharedAction) -> R>(f: F) -> R {
    let bytes = get_current_action_bytes();
    let act = <crate::SharedAction>::unpack(&bytes[..], &mut 0).unwrap(); // unwrap won't panic
    f(act)
}

/// Set the currently-executing action's return value
pub fn set_retval<'a, T: Packable<'a>>(val: &'a T) {
    let bytes = val.packed();
    unsafe { native_raw::setRetval(bytes.as_ptr(), bytes.len() as u32) };
}
