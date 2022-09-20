use crate::{ActionTrace, SignedTransaction};
use fracpack::Packable;
use std::{cell::UnsafeCell, ptr::null_mut};

/// This is the set of raw native functions (wasm imports) exposed by `psitest`.
/// They are available for test cases to use directly, but we recommend using
/// [`Chain`], [`execute`], and [`read_whole_file`] instead.
pub mod tester_raw {
    extern "C" {
        /// Create a new chain and make it active for database native functions.
        ///
        /// `max_objects` is the maximum number of objects the database can hold.
        /// The remaining arguments are log-base-2 of file sizes for the database's
        /// various files. e.g. `32` is 4 GB.
        ///
        /// Returns a chain handle
        pub fn testerCreateChain(
            max_objects: u64,
            hot_addr_bits: u64,
            warm_addr_bits: u64,
            cool_addr_bits: u64,
            cold_addr_bits: u64,
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
        ///
        /// The callback `cb_alloc` must allocate `size` bytes and return a pointer to it.
        /// If it can't allocate the memory, then it must abort, either by `panic`,
        /// [`raw::abortMessage`](crate::raw::abortMessage), or the `unreachable` instruction.
        /// `testerPushTransaction` does not hold onto the pointer; it fills it with a
        /// packed [`TransactionTrace`](crate::TransactionTrace) then returns.
        /// `testerPushTransaction` passes `alloc_context` to `cb_alloc`.
        pub fn testerPushTransaction(
            chain_handle: u32,
            transaction: *const u8,
            transaction_size: usize,
            alloc_context: *mut u8,
            cb_alloc: unsafe extern "C" fn(alloc_context: *mut u8, size: usize) -> *mut u8,
        );

        /// Read a file into memory
        ///
        /// Returns true if successful.
        ///
        /// The callback `cb_alloc` must allocate `size` bytes and return a pointer to it.
        /// If it can't allocate the memory, then it must abort, either by `panic`,
        /// [`raw::abortMessage`](crate::raw::abortMessage), or the `unreachable` instruction.
        /// `testerReadWholeFile` does not hold onto the pointer; it fills it then returns.
        /// `testerReadWholeFile` passes `alloc_context` to `cb_alloc`.
        pub fn testerReadWholeFile(
            filename: *const u8,
            filename_size: usize,
            alloc_context: *mut u8,
            cb_alloc: unsafe extern "C" fn(alloc_context: *mut u8, size: usize) -> *mut u8,
        ) -> bool;

        /// Select chain for database native functions
        ///
        /// After you call `testerSelectChainForDb`, the following functions will use
        /// this chain's database:
        ///
        /// * [`raw::kvGet`](crate::raw::kvGet)
        /// * [`raw::getSequential`](crate::raw::getSequential)
        /// * [`raw::kvGreaterEqual`](crate::raw::kvGreaterEqual)
        /// * [`raw::kvLessThan`](crate::raw::kvLessThan)
        /// * [`raw::kvMax`](crate::raw::kvMax)
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
        /// Starts a new block `skip_milliseconds/1000 + 1` seconds after either
        /// the head block, or the current block if one is being produced.
        ///
        /// TODO: replace `skip_milliseconds` with a time stamp
        ///
        /// TODO: Support sub-second block times
        pub fn testerStartBlock(chain_handle: u32, skip_milliseconds: i64);
    }
}

/// Execute a shell command
///
/// Returns the process exit code
pub fn execute(command: &str) -> i32 {
    unsafe { tester_raw::testerExecute(command.as_ptr(), command.len()) }
}

/// Read a file into memory. Returns `None` if failure.
pub fn read_whole_file(filename: &str) -> Option<Vec<u8>> {
    struct Context {
        size: usize,
        bytes: Vec<u8>,
    }
    let context = UnsafeCell::new(Context {
        size: 0,
        bytes: Vec::new(),
    });
    unsafe {
        unsafe extern "C" fn alloc(alloc_context: *mut u8, size: usize) -> *mut u8 {
            let context = &mut *UnsafeCell::raw_get(alloc_context as *const UnsafeCell<Context>);
            context.size = size;
            context.bytes.reserve(size);
            context.bytes.as_mut_ptr()
        }
        if !tester_raw::testerReadWholeFile(
            filename.as_ptr(),
            filename.len(),
            (&context) as *const UnsafeCell<Context> as *mut u8,
            alloc,
        ) {
            return None;
        }
        let mut context = context.into_inner();
        context.bytes.set_len(context.size);
        Some(context.bytes)
    }
}

#[derive(Debug, Default)]
pub struct Chain {
    chain_handle: u32,
}

impl Drop for Chain {
    fn drop(&mut self) {
        unsafe { tester_raw::testerDestroyChain(self.chain_handle) }
    }
}

impl Chain {
    /// Create a new chain and make it active for database native functions.
    ///
    /// Shortcut for `Tester::create(1_000_000_000, 32, 32, 32, 38)`
    pub fn new() -> Chain {
        Self::create(1_000_000_000, 32, 32, 32, 38)
    }

    /// Create a new chain and make it active for database native functions.
    ///
    /// `max_objects` is the maximum number of objects the database can hold.
    /// The remaining arguments are log-base-2 of file sizes for the database's
    /// various files. e.g. `32` is 4 GB.
    pub fn create(
        max_objects: u64,
        hot_addr_bits: u64,
        warm_addr_bits: u64,
        cool_addr_bits: u64,
        cold_addr_bits: u64,
    ) -> Chain {
        unsafe {
            Chain {
                chain_handle: tester_raw::testerCreateChain(
                    max_objects,
                    hot_addr_bits,
                    warm_addr_bits,
                    cool_addr_bits,
                    cold_addr_bits,
                ),
            }
        }
    }

    /// Start a new block
    ///
    /// Starts a new block `skip_milliseconds/1000 + 1` seconds after either
    /// the head block, or the current block if one is being produced.
    ///
    /// TODO: replace `skip_milliseconds` with a time stamp
    ///
    /// TODO: Support sub-second block times
    pub fn start_block(&mut self, skip_milliseconds: i64) {
        unsafe { tester_raw::testerStartBlock(self.chain_handle, skip_milliseconds) }
    }

    /// Finish a block
    ///
    /// This does nothing if a block isn't currently being produced.
    pub fn finish_block(&mut self) {
        unsafe { tester_raw::testerFinishBlock(self.chain_handle) }
    }

    /// Push a transaction
    pub fn push(&mut self, transaction: &SignedTransaction) -> ActionTrace {
        let transaction = transaction.packed();
        struct Context {
            size: usize,
            bytes: Vec<u8>,
        }
        let context = UnsafeCell::new(Context {
            size: 0,
            bytes: Vec::new(),
        });
        unsafe {
            unsafe extern "C" fn alloc(alloc_context: *mut u8, size: usize) -> *mut u8 {
                let context =
                    &mut *UnsafeCell::raw_get(alloc_context as *const UnsafeCell<Context>);
                context.size = size;
                context.bytes.reserve(size);
                context.bytes.as_mut_ptr()
            }
            tester_raw::testerPushTransaction(
                self.chain_handle,
                transaction.as_ptr(),
                transaction.len(),
                (&context) as *const UnsafeCell<Context> as *mut u8,
                alloc,
            );
            let mut context = context.into_inner();
            context.bytes.set_len(context.size);
            ActionTrace::unpacked(&context.bytes).unwrap()
        }
    }

    /// Copy database to `path`
    ///
    /// Runs the following shell command: `mkdir -p {path} && cp -a {src}/* {path}`,
    /// where `{path}` is the passed-in argument and `{src}` is the chain's database.
    ///
    /// Returns shell exit status; 0 if successful
    pub fn copy_database(&self, path: &str) -> i32 {
        let src = unsafe { self.get_path() };
        execute(&format! {"mkdir -p {path} && cp -a {src}/* {path}", src = src, path = path})
    }

    /// Get filesystem path of chain's database
    ///
    /// See [`copy_database`](Self::copy_database) for the most-common use case
    ///
    /// # Safety
    ///
    /// It is safe to copy the files to another location on the filesystem. However,
    /// modifying the original files or launching `psinode` on the original files
    /// will corrupt the database and likely crash the `psitest` process running this
    /// wasm.
    pub unsafe fn get_path(&self) -> String {
        let size = tester_raw::testerGetChainPath(self.chain_handle, null_mut(), 0);
        let mut bytes = Vec::with_capacity(size);
        tester_raw::testerGetChainPath(self.chain_handle, bytes.as_mut_ptr(), size);
        bytes.set_len(size);
        String::from_utf8_unchecked(bytes)
    }

    /// Select chain for database native functions
    ///
    /// After you call `select_chain`, the following functions will use
    /// this chain's database:
    ///
    /// * [`raw::kvGet`](crate::raw::kvGet)
    /// * [`raw::getSequential`](crate::raw::getSequential)
    /// * [`raw::kvGreaterEqual`](crate::raw::kvGreaterEqual)
    /// * [`raw::kvLessThan`](crate::raw::kvLessThan)
    /// * [`raw::kvMax`](crate::raw::kvMax)
    pub fn select_chain(&self) {
        unsafe { tester_raw::testerSelectChainForDb(self.chain_handle) }
    }
}
