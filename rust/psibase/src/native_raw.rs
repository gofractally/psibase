//! Raw native functions for services to use
//!
//! This is the set of raw native functions (wasm imports). They are
//! available for services to use directly, but we recommend using
//! the [Wrapped Native Functions](crate::native) instead.

extern "C" {
    /// Copy `min(dest_size, resultSize - offset)` bytes from
    /// `result + offset` into `dest` and return `resultSize`
    ///
    /// If `offset >= resultSize`, then skip the copy.
    ///
    /// Other functions set or clear result. `getResult`, [getKey], and
    /// [writeConsole] are the only raw functions which leave the current
    /// result and key intact.
    pub fn getResult(dest: *mut u8, dest_size: u32, offset: u32) -> u32;

    /// Copy `min(dest_size, key_size)` bytes of the most-recent key into
    /// dest and return `key_size`
    ///
    /// Other functions set or clear the key. [getResult], `getKey`, and
    /// [writeConsole] are the only raw functions which leave the current
    /// result and key intact.
    pub fn getKey(dest: *mut u8, dest_size: u32) -> u32;

    /// Write `message` to console
    ///
    /// Message should be UTF8.
    pub fn writeConsole(message: *const u8, len: u32);

    /// Abort with `message`
    ///
    /// Message should be UTF8.
    pub fn abortMessage(message: *const u8, len: u32) -> !;

    /// Store the currently-executing action into result and return the result size
    ///
    /// The result contains a fracpacked [crate::Action]; use [getResult] to get it.
    ///
    /// If the service, while handling action A, calls itself with action B:
    /// * Before the call to B, `getCurrentAction()` returns A.
    /// * After the call to B, `getCurrentAction()` returns B.
    /// * After B returns, `getCurrentAction()` returns A.
    ///
    /// Note: The above only applies if the service uses [call]. [Actor] uses [call].
    pub fn getCurrentAction() -> u32;

    /// Call a service, store the return value into result, and return the result size
    ///
    /// `action` must contain a fracpacked [crate::Action].
    ///
    /// Use [getResult] to get result.
    pub fn call(action: *const u8, len: u32) -> u32;

    /// Set the currently-executing action's return value
    pub fn setRetval(retval: *const u8, len: u32);

    /// Set a key-value pair
    ///
    /// If key already exists, then replace the existing value.
    pub fn kvPut(db: crate::DbId, key: *const u8, key_len: u32, value: *const u8, value_len: u32);

    /// Add a sequentially-numbered record
    ///
    /// Returns the id.
    pub fn putSequential(db: crate::DbId, value: *const u8, value_len: u32) -> u64;

    /// Remove a key-value pair if it exists
    pub fn kvRemove(db: crate::DbId, key: *const u8, key_len: u32);

    /// Get a key-value pair, if any
    ///
    /// If key exists, then sets result to value and returns size. If key does not
    /// exist, returns `u32::MAX` and clears result. Use [getResult] to get result.
    pub fn kvGet(db: crate::DbId, key: *const u8, key_len: u32) -> u32;

    /// Get a sequentially-numbered record
    ///
    /// If `id` is available, then sets result to value and returns size. If id does
    /// not exist, returns `u32::MAX` and clears result.
    pub fn getSequential(db: crate::DbId, id: u64) -> u32;

    /// Get the first key-value pair which is greater than or equal to the provided
    /// key
    ///
    /// If one is found, and the first `match_key_size` bytes of the found key
    /// matches the provided key, then sets result to value and returns size. Also
    /// sets key. Otherwise returns `u32::MAX` and clears result. Use [getResult] to get
    /// result and [getKey] to get found key.
    pub fn kvGreaterEqual(
        db: crate::DbId,
        key: *const u8,
        key_len: u32,
        match_key_size: u32,
    ) -> u32;

    /// Get the key-value pair immediately-before provided key
    ///
    /// If one is found, and the first `match_key_size` bytes of the found key
    /// matches the provided key, then sets result to value and returns size.
    /// Also sets key. Otherwise returns `u32::MAX` and clears result. Use [getResult]
    /// to get result and [getKey] to get found key.
    pub fn kvLessThan(db: crate::DbId, key: *const u8, key_len: u32, match_key_size: u32) -> u32;

    /// Get the maximum key-value pair which has key as a prefix
    ///
    /// If one is found, then sets result to value and returns size. Also sets key.
    /// Otherwise returns `u32::MAX` and clears result. Use [getResult] to get result
    /// and [getKey] to get found key.
    pub fn kvMax(db: crate::DbId, key: *const u8, key_len: u32) -> u32;
}
