//! Wrapped native functions for services to use
//!
//! Native functions give services the ability to print debugging messages,
//! abort transactions on errors, access databases and event logs, and
//! synchronously call other services. There aren't many native functions
//! since services implement most psibase functionality.
//!
//! These functions wrap the [Raw Native Functions](crate::native_raw).

use crate::{native_raw, AccountNumber, DbId, ToKey};
use fracpack::{Pack, Unpack, UnpackOwned};

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

/// Abort with message if optional value is empty
pub fn check_some<T>(opt_value: Option<T>, message: &str) -> T {
    if opt_value.is_none() {
        abort_message_bytes(message.as_bytes());
    }
    opt_value.unwrap()
}

/// Abort with message if optional has value
pub fn check_none<T>(opt_value: Option<T>, message: &str) {
    if opt_value.is_some() {
        abort_message_bytes(message.as_bytes());
    }
}

/// Get the most-recent result when the size is known in advance
///
/// Other functions set the result.
pub fn get_result_bytes(size: u32) -> Vec<u8> {
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
pub fn get_key_bytes() -> Vec<u8> {
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
pub fn set_retval<T: Pack>(val: &T) {
    let bytes = val.packed();
    unsafe { native_raw::setRetval(bytes.as_ptr(), bytes.len() as u32) };
}

fn get_optional_result_bytes(size: u32) -> Option<Vec<u8>> {
    if size < u32::MAX {
        Some(get_result_bytes(size))
    } else {
        None
    }
}

/// Set a key-value pair
///
/// If key already exists, then replace the existing value.
pub fn kv_put_bytes(db: DbId, key: &[u8], value: &[u8]) {
    unsafe {
        native_raw::kvPut(
            db,
            key.as_ptr(),
            key.len() as u32,
            value.as_ptr(),
            value.len() as u32,
        )
    }
}

/// Set a key-value pair
///
/// If key already exists, then replace the existing value.
pub fn kv_put<K: ToKey, V: Pack>(db: DbId, key: &K, value: &V) {
    kv_put_bytes(db, &key.to_key(), &value.packed())
}

/// Add a sequentially-numbered record
///
/// Returns the id.
pub fn put_sequential_bytes(db: DbId, value: &[u8]) -> u64 {
    unsafe { native_raw::putSequential(db, value.as_ptr(), value.len() as u32) }
}

/// Add a sequentially-numbered record
///
/// Returns the id.
pub fn put_sequential<Type: Pack, V: Pack>(
    db: DbId,
    service: AccountNumber,
    ty: &Type,
    value: &V,
) -> u64 {
    let mut packed = Vec::new();
    service.pack(&mut packed);
    ty.pack(&mut packed);
    value.pack(&mut packed);
    put_sequential_bytes(db, &packed)
}

/// Remove a key-value pair if it exists
pub fn kv_remove_bytes(db: DbId, key: &[u8]) {
    unsafe { native_raw::kvRemove(db, key.as_ptr(), key.len() as u32) }
}

/// Remove a key-value pair if it exists
pub fn kv_remove<K: ToKey>(db: DbId, key: &K) {
    kv_remove_bytes(db, &key.to_key())
}

/// Get a key-value pair, if any
pub fn kv_get_bytes(db: DbId, key: &[u8]) -> Option<Vec<u8>> {
    let size = unsafe { native_raw::kvGet(db, key.as_ptr(), key.len() as u32) };
    get_optional_result_bytes(size)
}

/// Get a key-value pair, if any
pub fn kv_get<V: UnpackOwned, K: ToKey>(db: DbId, key: &K) -> Result<Option<V>, fracpack::Error> {
    if let Some(v) = kv_get_bytes(db, &key.to_key()) {
        Ok(Some(V::unpacked(&v)?))
    } else {
        Ok(None)
    }
}

/// Get the first key-value pair which is greater than or equal to the provided
/// key
///
/// If one is found, and the first `match_key_size` bytes of the found key
/// matches the provided key, then returns the value. Use [get_key_bytes] to get
/// the found key.
pub fn kv_greater_equal_bytes(db: DbId, key: &[u8], match_key_size: u32) -> Option<Vec<u8>> {
    let size =
        unsafe { native_raw::kvGreaterEqual(db, key.as_ptr(), key.len() as u32, match_key_size) };
    get_optional_result_bytes(size)
}

/// Get the first key-value pair which is greater than or equal to the provided
/// key
///
/// If one is found, and the first `match_key_size` bytes of the found key
/// matches the provided key, then returns the value. Use [get_key_bytes] to get
/// the found key.
pub fn kv_greater_equal<K: ToKey, V: UnpackOwned>(
    db_id: DbId,
    key: &K,
    match_key_size: u32,
) -> Option<V> {
    let bytes = kv_greater_equal_bytes(db_id, &key.to_key(), match_key_size);
    bytes.map(|v| V::unpack(&v[..], &mut 0).unwrap())
}

/// Get the key-value pair immediately-before provided key
///
/// If one is found, and the first `match_key_size` bytes of the found key
/// matches the provided key, then returns the value. Use [get_key_bytes] to get
/// the found key.
pub fn kv_less_than_bytes(db: DbId, key: &[u8], match_key_size: u32) -> Option<Vec<u8>> {
    let size =
        unsafe { native_raw::kvLessThan(db, key.as_ptr(), key.len() as u32, match_key_size) };
    get_optional_result_bytes(size)
}

/// Get the key-value pair immediately-before provided key
///
/// If one is found, and the first `match_key_size` bytes of the found key
/// matches the provided key, then returns the value. Use [get_key_bytes] to get
/// the found key.
pub fn kv_less_than<K: ToKey, V: UnpackOwned>(
    db_id: DbId,
    key: &K,
    match_key_size: u32,
) -> Option<V> {
    let bytes = kv_less_than_bytes(db_id, &key.to_key(), match_key_size);
    bytes.map(|v| V::unpack(&v[..], &mut 0).unwrap())
}

/// Get the maximum key-value pair which has key as a prefix
///
/// If one is found, then returns the value. Use [get_key_bytes] to get the found key.
pub fn kv_max_bytes(db: DbId, key: &[u8]) -> Option<Vec<u8>> {
    let size = unsafe { native_raw::kvMax(db, key.as_ptr(), key.len() as u32) };
    get_optional_result_bytes(size)
}

/// Get the maximum key-value pair which has key as a prefix
///
/// If one is found, then returns the value. Use [get_key_bytes] to get the found key.
pub fn kv_max<K: ToKey, V: UnpackOwned>(db_id: DbId, key: &K) -> Option<V> {
    let bytes = kv_max_bytes(db_id, &key.to_key());
    bytes.map(|v| V::unpack(&v[..], &mut 0).unwrap())
}
