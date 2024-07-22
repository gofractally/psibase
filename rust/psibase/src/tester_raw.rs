//! Raw native functions for tests to use
//!
//! Native functions give tests the ability to execute shell commands,
//! read files, create block chains, push transactions to those chains,
//! and control block production on those chains.
//!
//! This is the set of raw native functions (wasm imports) exposed by `psitest`.
//! They are available for test cases to use directly, but we recommend using
//! [Wrapped Native Functions](crate::tester) instead.

extern "C" {
    /// Execute a shell command
    ///
    /// Returns the process exit code
    pub fn testerExecute(command: *const u8, command_size: usize) -> i32;
}

#[link(wasm_import_module = "psibase")]
extern "C" {
    /// Create a new chain and make it active for database native functions.
    ///
    /// Returns a chain handle
    pub fn createChain(hot_bytes: u64, warm_bytes: u64, cool_bytes: u64, cold_bytes: u64) -> u32;

    /// Destroy chain
    ///
    /// This destroys the chain and deletes its database from the filesystem.
    pub fn destroyChain(chain_handle: u32);

    /// Finish a block
    ///
    /// This does nothing if a block isn't currently being produced.
    pub fn finishBlock(chain_handle: u32);

    /// Get filesystem path of chain's database
    ///
    /// Stores up to `dest_size` bytes if the chain's path into `dest`. Returns
    /// the path size. The path is UTF8.
    ///
    /// It is safe to copy the files to another location on the filesystem. However,
    /// modifying the original files or launching `psinode` on the original files
    /// will corrupt the database and likely crash the `psitest` process running this wasm.
    pub fn getChainPath(chain_handle: u32, dest: *mut u8, dest_size: usize) -> usize;

    /// Push a transaction
    ///
    /// `chain_handle` identifies the chain to push to. `transaction/transaction_size`
    /// contains a fracpacked [`SignedTransaction`](crate::SignedTransaction).
    ///
    /// Stores the transaction trace into result and returns the result size
    pub fn pushTransaction(
        chain_handle: u32,
        transaction: *const u8,
        transaction_size: usize,
    ) -> u32;

    /// Shutdown chain without deleting database
    ///
    /// This shuts down a chain, but doesn't destroy it or remove the
    /// database. `chain_handle` still exists, but isn't usable except
    /// with [`getChainPath`] and [`destroyChain`].
    ///
    /// TODO: `shutdownChain` probably isn't useful anymore; it might go away.
    pub fn shutdownChain(chain_handle: u32);

    /// Start a new block
    ///
    /// Starts a new block at time `time_seconds` (unix time). If
    /// time_seconds is 0, then starts a new block 1 second after
    /// the most recent.
    ///
    /// TODO: Support sub-second block times
    pub fn startBlock(chain_handle: u32, time_seconds: u32);

    /// Runs an HttpRequest and returns the TransactionTrace
    pub fn httpRequest(
        chain_handle: u32,
        request_packed: *const u8,
        request_packed_size: usize,
    ) -> u32;
}

#[cfg(target_family = "wasm")]
#[link(wasm_import_module = "psibase")]
extern "C" {
    pub fn getResult(dest: *mut u8, dest_size: u32, offset: u32) -> u32;
    pub fn getKey(dest: *mut u8, dest_size: u32) -> u32;
    pub fn abortMessage(message: *const u8, len: u32) -> !;
    pub fn kvGet(chain_handle: u32, db: crate::DbId, key: *const u8, key_len: u32) -> u32;
    pub fn getSequential(chain_handle: u32, db: crate::DbId, id: u64) -> u32;
    pub fn kvGreaterEqual(
        chain_handle: u32,
        db: crate::DbId,
        key: *const u8,
        key_len: u32,
        match_key_size: u32,
    ) -> u32;
    pub fn kvLessThan(
        chain_handle: u32,
        db: crate::DbId,
        key: *const u8,
        key_len: u32,
        match_key_size: u32,
    ) -> u32;
    pub fn kvMax(chain_handle: u32, db: crate::DbId, key: *const u8, key_len: u32) -> u32;
}

thread_local! {
    static SELECTED_CHAIN: std::cell::Cell<Option<u32>> = std::cell::Cell::new(None);
}

pub fn get_selected_chain() -> u32 {
    SELECTED_CHAIN.with(|c| c.get().unwrap())
}

/// Select chain for database native functions
///
/// After you call `tester_select_chain_for_db`, the following functions will use
/// this chain's database:
///
/// * [`raw::kvGet`](crate::native_raw::kvGet)
/// * [`raw::getSequential`](crate::native_raw::getSequential)
/// * [`raw::kvGreaterEqual`](crate::native_raw::kvGreaterEqual)
/// * [`raw::kvLessThan`](crate::native_raw::kvLessThan)
/// * [`raw::kvMax`](crate::native_raw::kvMax)
pub fn tester_select_chain_for_db(chain_handle: u32) {
    SELECTED_CHAIN.with(|c| c.set(Some(chain_handle)));
}

pub fn tester_clear_chain_for_db(chain_handle: u32) {
    SELECTED_CHAIN.with(|c| {
        if let Some(current) = c.get() {
            if chain_handle == current {
                c.set(None)
            }
        }
    });
}
