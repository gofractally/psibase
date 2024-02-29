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
    /// Create a new chain and make it active for database native functions.
    ///
    /// The arguments are the file sizes in bytes for the database's
    /// various files.
    ///
    /// Returns a chain handle
    pub fn testerCreateChain(
        hot_bytes: u64,
        warm_bytes: u64,
        cool_bytes: u64,
        cold_bytes: u64,
    ) -> u32;

    /// Destroy chain
    ///
    /// This destroys the chain and deletes its database from the filesystem.
    pub fn testerDestroyChain(chain_handle: u32);

    /// Execute a shell command
    ///
    /// Returns the process exit code
    pub fn testerExecute(command: *const u8, command_size: usize) -> i32;

    /// Finish a block
    ///
    /// This does nothing if a block isn't currently being produced.
    pub fn testerFinishBlock(chain_handle: u32);

    /// Get filesystem path of chain's database
    ///
    /// Stores up to `dest_size` bytes if the chain's path into `dest`. Returns
    /// the path size. The path is UTF8.
    ///
    /// It is safe to copy the files to another location on the filesystem. However,
    /// modifying the original files or launching `psinode` on the original files
    /// will corrupt the database and likely crash the `psitest` process running this wasm.
    pub fn testerGetChainPath(chain_handle: u32, dest: *mut u8, dest_size: usize) -> usize;

    /// Push a transaction
    ///
    /// `chain_handle` identifies the chain to push to. `transaction/transaction_size`
    /// contains a fracpacked [`SignedTransaction`](crate::SignedTransaction).
    pub fn testerPushTransaction(
        chain_handle: u32,
        transaction: *const u8,
        transaction_size: usize
    ) -> u32;

    /// Select chain for database native functions
    ///
    /// After you call `testerSelectChainForDb`, the following functions will use
    /// this chain's database:
    ///
    /// * [`raw::kvGet`](crate::native_raw::kvGet)
    /// * [`raw::getSequential`](crate::native_raw::getSequential)
    /// * [`raw::kvGreaterEqual`](crate::native_raw::kvGreaterEqual)
    /// * [`raw::kvLessThan`](crate::native_raw::kvLessThan)
    /// * [`raw::kvMax`](crate::native_raw::kvMax)
    pub fn testerSelectChainForDb(chain_handle: u32);

    /// Shutdown chain without deleting database
    ///
    /// This shuts down a chain, but doesn't destroy it or remove the
    /// database. `chain_handle` still exists, but isn't usable except
    /// with [`testerGetChainPath`] and [`testerDestroyChain`].
    ///
    /// TODO: `testerShutdownChain` probably isn't useful anymore; it might go away.
    pub fn testerShutdownChain(chain_handle: u32);

    /// Start a new block
    ///
    /// Starts a new block at time `time_seconds` (unix time). If
    /// time_seconds is 0, then starts a new block 1 second after
    /// the most recent.
    ///
    /// TODO: Support sub-second block times
    pub fn testerStartBlock(chain_handle: u32, time_seconds: u32);
}
