//! Wrapped native functions for tests to use
//!
//! Native functions give tests the ability to execute shell commands,
//! read files, create block chains, push transactions to those chains,
//! and control block production on those chains.
//!
//! These functions and types wrap the [Raw Native Functions](crate::tester_raw).

use crate::{tester_raw, SignedTransaction, TransactionTrace};
use fracpack::Packable;
use std::{cell::UnsafeCell, ptr::null_mut};

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

/// Block chain under test
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
    /// Starts a new block at time `time_seconds` (unix time). If
    /// time_seconds is 0, then starts a new block 1 second after
    /// the most recent.
    ///
    /// TODO: Support sub-second block times
    pub fn start_block(&mut self, time_seconds: u32) {
        unsafe { tester_raw::testerStartBlock(self.chain_handle, time_seconds) }
    }

    /// Finish a block
    ///
    /// This does nothing if a block isn't currently being produced.
    pub fn finish_block(&mut self) {
        unsafe { tester_raw::testerFinishBlock(self.chain_handle) }
    }

    /// Push a transaction
    pub fn push(&mut self, transaction: &SignedTransaction) -> TransactionTrace {
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
            TransactionTrace::unpacked(&context.bytes).unwrap()
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
    /// * [`native_raw::kvGet`](crate::native_raw::kvGet)
    /// * [`native_raw::getSequential`](crate::native_raw::getSequential)
    /// * [`native_raw::kvGreaterEqual`](crate::native_raw::kvGreaterEqual)
    /// * [`native_raw::kvLessThan`](crate::native_raw::kvLessThan)
    /// * [`native_raw::kvMax`](crate::native_raw::kvMax)
    pub fn select_chain(&self) {
        unsafe { tester_raw::testerSelectChainForDb(self.chain_handle) }
    }
}
