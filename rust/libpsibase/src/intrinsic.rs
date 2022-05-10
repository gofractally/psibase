use fracpack::Packable;

pub mod raw {
    extern "C" {
        /// Write `message` to console
        ///
        /// Message should be UTF8.
        pub fn write_console(message: *const u8, len: u32);

        /// Abort with `message`
        ///
        /// Message should be UTF8.
        pub fn abort_message(message: *const u8, len: u32) -> !;

        /// Copy `min(dest_size, result_size)` bytes of the most-recent result
        /// into dest and return `result_size`
        ///
        /// Other functions set the result.
        pub fn get_result(dest: *mut u8, dest_size: u32) -> u32;

        /// Copy `min(dest_size, key_size)` bytes of the most-recent key into
        /// dest and return `key_size`
        ///
        /// Other functions set the key.
        pub fn get_key(dest: *mut u8, dest_size: u32) -> u32;

        /// Store the currently-executing action into result and return the result size
        ///
        /// Use [get_result] to get result.
        ///
        /// If the contract, while handling action A, calls itself with action B:
        ///    * Before the call to B, [get_current_action] returns A.
        ///    * After the call to B, [get_current_action] returns B.
        ///    * After B returns, [get_current_action] returns A.
        ///
        /// Note: The above only applies if the contract uses [call].
        pub fn get_current_action() -> u32;

        /// Call a contract, store the return value into result, and return the result size
        ///
        /// Use [get_result] to get result.
        pub fn call(action: *const u8, len: u32);

        /// Set the return value of the currently-executing action
        pub fn set_retval(retval: *const u8, len: u32);

        /// Set a key-value pair. If key already exists, then replace the existing value
        ///
        /// Don't use [get_key] after calling this.
        pub fn kv_put(
            db: crate::DbId,
            key: *const u8,
            key_len: u32,
            value: *const u8,
            value_len: u32,
        );

        /// Remove a key-value pair if it exists
        ///
        /// Don't use [get_key] after calling this.
        pub fn kv_remove(db: crate::DbId, key: *const u8, key_len: u32);

        /// Get a key-value pair, if any
        ///
        /// If key exists, then sets result to value and returns size. If key does not
        /// exist, returns `-1` and clears result. Use [get_result] to get result.
        ///
        /// Don't use [get_key] after calling this.
        pub fn kv_get(db: crate::DbId, key: *const u8, key_len: u32) -> u32;

        /// Get the first key-value pair which is greater than or equal to the provided
        /// key
        ///
        /// If one is found, and the first `match_key_size` bytes of the found key
        /// matches the provided key, then sets result to value and returns size. Also
        /// sets key. Otherwise returns `-1` and clears result. Use [get_result] to get
        /// result and [get_key] to get found key.
        pub fn kv_greater_equal(
            db: crate::DbId,
            key: *const u8,
            key_len: u32,
            match_key_size: u32,
        ) -> u32;

        /// Get the key-value pair immediately-before provided key
        ///
        /// If one is found, and the first `match_key_size` bytes of the found key
        /// matches the provided key, then sets result to value and returns size.
        /// Also sets key. Otherwise returns `-1` and clears result. Use [get_result]
        /// to get result and [get_key] to get found key.
        pub fn kv_less_than(
            db: crate::DbId,
            key: *const u8,
            key_len: u32,
            match_key_size: u32,
        ) -> u32;

        /// Get the maximum key-value pair which has key as a prefix
        ///
        /// If one is found, then sets result to value and returns size. Also sets key.
        /// Otherwise returns `-1` and clears result. Use [get_result] to get result
        /// and [get_key] to get found key.
        pub fn kv_max(db: crate::DbId, key: *const u8, key_len: u32) -> u32;
    }
}

/// Write message to console
///
/// Message should be UTF8.
pub fn write_console_bytes(message: &[u8]) {
    unsafe {
        if let Some(first) = message.first() {
            raw::write_console(first, message.len() as u32);
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
            raw::abort_message(first, message.len() as u32)
        } else {
            raw::abort_message(std::ptr::null(), 0)
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

/// Get the most-recent result
///
/// Other functions set the result.
pub fn get_result_bytes() -> Vec<u8> {
    unsafe {
        let size = raw::get_result(std::ptr::null_mut(), 0);
        let mut result = Vec::with_capacity(size as usize);
        if size > 0 {
            raw::get_result(result.as_mut_ptr(), size);
            result.set_len(size as usize);
        }
        result
    }
}

/// Get the most-recent result when the size is known in advance
///
/// Other functions set the result.
pub fn get_result_bytes_known_size(size: u32) -> Vec<u8> {
    let mut result = Vec::with_capacity(size as usize);
    if size > 0 {
        unsafe {
            let actual_size = raw::get_result(result.as_mut_ptr(), size);
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
        let size = raw::get_key(std::ptr::null_mut(), 0);
        let mut result = Vec::with_capacity(size as usize);
        if size > 0 {
            raw::get_key(result.as_mut_ptr(), size);
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
/// Note: The above only applies if the contract uses [call].
pub fn get_current_action_bytes() -> Vec<u8> {
    let size;
    unsafe {
        size = raw::get_current_action();
    };
    get_result_bytes_known_size(size)
}

/// Get the currently-executing action.
///
/// This version creates an extra copy of [crate::Action::raw_data];
/// consider using [with_current_action] instead.
///
/// If the contract, while handling action A, calls itself with action B:
///    * Before the call to B, [get_current_action] returns A.
///    * After the call to B, [get_current_action] returns B.
///    * After B returns, [get_current_action] returns A.
///
/// Note: The above only applies if the contract uses [call].
pub fn get_current_action() -> crate::Action {
    let bytes = get_current_action_bytes();
    <crate::Action>::unpack(&bytes[..], &mut 0).unwrap() // unwrap won't panic
}

/// Get the currently-executing action and pass it to `f`.
///
/// This is more efficient than [get_current_action] since it avoids
/// creating an extra copy of [crate::Action::raw_data].
///
/// If the contract, while handling action A, calls itself with action B:
///    * Before the call to B, [get_current_action] returns A.
///    * After the call to B, [get_current_action] returns B.
///    * After B returns, [get_current_action] returns A.
///
/// Note: The above only applies if the contract uses [call].
pub fn with_current_action<R, F: Fn(crate::SharedAction) -> R>(f: F) -> R {
    let bytes = get_current_action_bytes();
    let act = <crate::SharedAction>::unpack(&bytes[..], &mut 0).unwrap(); // unwrap won't panic
    f(act)
}
